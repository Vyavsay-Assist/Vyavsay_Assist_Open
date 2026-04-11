import { google, sheets_v4 } from 'googleapis';
import { JWT } from 'google-auth-library';
import { SupabaseClient } from '@supabase/supabase-js';
import { config } from '../config/environment.js';

// ─── Column headers for the Google Sheet ────────────────────
const HEADERS = [
  'Item Name',
  'Category',
  'Price',
  'Quantity',
  'Brand',
  'Fuel Type',
  'Transmission',
  'Color',
  'Year',
  'Ownership',
  'Kilometers',
  'Status',
];

// ─── Service class ──────────────────────────────────────────

export class SheetsSyncService {
  // ── Auth helpers ────────────────────────────────────────────

  /** Create a JWT auth client using the service account credentials. */
  getAuthClient(): JWT {
    if (!config.GOOGLE_SA_EMAIL || !config.GOOGLE_SA_KEY) {
      throw new Error('Google Sheets credentials not configured (GOOGLE_SA_EMAIL / GOOGLE_SA_KEY)');
    }

    return new JWT({
      email: config.GOOGLE_SA_EMAIL,
      key: config.GOOGLE_SA_KEY,
      scopes: ['https://www.googleapis.com/auth/spreadsheets'],
    });
  }

  /** Return an authorised Google Sheets v4 client. */
  getSheetsClient(): sheets_v4.Sheets {
    const auth = this.getAuthClient();
    return google.sheets({ version: 'v4', auth });
  }

  // ── Export: DB → Sheet ──────────────────────────────────────

  /**
   * Export all active catalog items for a user to the configured Google Sheet.
   * Clears existing content and writes fresh data.
   * @returns Number of data rows written (excluding header).
   */
  async exportToSheet(supabase: SupabaseClient, userId: string): Promise<number> {
    const sheets = this.getSheetsClient();
    const sheetName = config.GOOGLE_SHEET_NAME;
    const spreadsheetId = config.GOOGLE_SHEET_ID;

    // Fetch active catalog items
    const { data: items, error } = await supabase
      .from('wb_catalog_items')
      .select('item_name, category, price, quantity, attributes, is_active')
      .eq('user_id', userId)
      .eq('is_active', true);

    if (error) throw new Error(`Supabase fetch failed: ${error.message}`);

    const rows: (string | number)[][] = [HEADERS];

    for (const item of items ?? []) {
      const attrs = (item.attributes ?? {}) as Record<string, any>;
      rows.push([
        item.item_name ?? '',
        item.category ?? '',
        item.price ?? '',
        item.quantity ?? 0,
        attrs.brand ?? '',
        attrs.fuel_type ?? '',
        attrs.transmission ?? '',
        attrs.color ?? '',
        attrs.year ?? '',
        attrs.ownership ?? '',
        attrs.km_driven ?? '',
        'active',
      ]);
    }

    // Clear existing content
    await sheets.spreadsheets.values.clear({
      spreadsheetId,
      range: sheetName,
    });

    // Write all rows (header + data)
    await sheets.spreadsheets.values.update({
      spreadsheetId,
      range: `${sheetName}!A1`,
      valueInputOption: 'RAW',
      requestBody: { values: rows },
    });

    const dataRowCount = rows.length - 1;
    console.log(`[sheets-sync] Exported ${dataRowCount} items to Google Sheet`);
    return dataRowCount;
  }

  // ── Import: Sheet → DB ─────────────────────────────────────

  /**
   * Import rows from the Google Sheet into the database.
   * Existing items (matched by item_name) are updated; new items are inserted.
   * @returns Counts of added and updated rows.
   */
  async importFromSheet(
    supabase: SupabaseClient,
    userId: string,
  ): Promise<{ added: number; updated: number }> {
    const sheets = this.getSheetsClient();
    const sheetName = config.GOOGLE_SHEET_NAME;
    const spreadsheetId = config.GOOGLE_SHEET_ID;

    // Read all values
    const res = await sheets.spreadsheets.values.get({
      spreadsheetId,
      range: sheetName,
    });

    const allRows = res.data.values;
    if (!allRows || allRows.length < 2) {
      console.log('[sheets-sync] No data rows found in sheet');
      return { added: 0, updated: 0 };
    }

    // Parse header row to build column index
    const headerRow = allRows[0].map((h: string) =>
      h.trim().toLowerCase().replace(/\s+/g, '_'),
    );
    const col = (name: string): number => headerRow.indexOf(name);

    const dataRows = allRows.slice(1);

    let added = 0;
    let updated = 0;

    for (const row of dataRows) {
      const itemName = (row[col('item_name')] ?? '').toString().trim();
      if (!itemName) continue; // skip blank rows

      const category = (row[col('category')] ?? '').toString().trim() || null;
      const price = parseFloat(row[col('price')]) || null;
      const quantity = parseInt(row[col('quantity')], 10) || 0;

      const attributes: Record<string, any> = {};
      const attrFields = ['brand', 'fuel_type', 'transmission', 'color', 'year', 'ownership'];
      for (const field of attrFields) {
        const idx = col(field);
        if (idx >= 0 && row[idx] != null && row[idx] !== '') {
          attributes[field] = row[idx].toString().trim();
        }
      }
      // Kilometers column maps to km_driven attribute
      const kmIdx = col('kilometers');
      if (kmIdx >= 0 && row[kmIdx] != null && row[kmIdx] !== '') {
        attributes.km_driven = row[kmIdx].toString().trim();
      }

      // Check if item already exists
      const { data: existing } = await supabase
        .from('wb_catalog_items')
        .select('id')
        .eq('user_id', userId)
        .ilike('item_name', itemName)
        .limit(1)
        .single();

      const payload = {
        item_name: itemName,
        category,
        price,
        quantity,
        attributes,
        is_active: true,
        user_id: userId,
      };

      if (existing?.id) {
        // Update existing item
        const { error } = await supabase
          .from('wb_catalog_items')
          .update({
            category: payload.category,
            price: payload.price,
            quantity: payload.quantity,
            attributes: payload.attributes,
            is_active: payload.is_active,
          })
          .eq('id', existing.id);

        if (error) {
          console.error(`[sheets-sync] Failed to update "${itemName}": ${error.message}`);
        } else {
          updated++;
        }
      } else {
        // Insert new item
        const { error } = await supabase.from('wb_catalog_items').insert(payload);

        if (error) {
          console.error(`[sheets-sync] Failed to insert "${itemName}": ${error.message}`);
        } else {
          added++;
        }
      }
    }

    console.log(`[sheets-sync] Import complete — added: ${added}, updated: ${updated}`);
    return { added, updated };
  }

  // ── Bidirectional sync ─────────────────────────────────────

  /**
   * Run a full bidirectional sync:
   *  1. Import from sheet (sheet wins for existing rows)
   *  2. Export to sheet (ensures sheet has all items, including dashboard-added ones)
   */
  async syncBidirectional(
    supabase: SupabaseClient,
    userId: string,
  ): Promise<{ imported: { added: number; updated: number }; exported: number }> {
    console.log('[sheets-sync] Starting bidirectional sync...');

    // Step 1 — Sheet → DB
    const imported = await this.importFromSheet(supabase, userId);

    // Step 2 — DB → Sheet (now includes everything)
    const exported = await this.exportToSheet(supabase, userId);

    console.log('[sheets-sync] Bidirectional sync complete');
    return { imported, exported };
  }
}

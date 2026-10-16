import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

// Ensure data directory exists for persistent SQLite database
const dataDir = path.resolve(process.cwd(), 'data');
if (!fs.existsSync(dataDir)) {
  fs.mkdirSync(dataDir, { recursive: true });
}

const dbPath = path.join(dataDir, 'pos.db');
export const db = new DatabaseSync(dbPath);

// Enable WAL mode and foreign keys for high-performance ACID compliance
db.exec('PRAGMA journal_mode = WAL;');
db.exec('PRAGMA foreign_keys = ON;');

export function hashPassword(password: string, salt?: string): { hash: string; salt: string } {
  const finalSalt = salt || crypto.randomBytes(16).toString('hex');
  const hash = crypto.pbkdf2Sync(password, finalSalt, 1000, 64, 'sha512').toString('hex');
  return { hash, salt: finalSalt };
}

export function verifyPassword(password: string, hash: string, salt: string): boolean {
  const result = crypto.pbkdf2Sync(password, salt, 1000, 64, 'sha512').toString('hex');
  return result === hash;
}

// Initialize tables with STRICT ZERO FAKE DATA policy
// No demo rows or fake users are inserted here.
export function initDatabase() {
  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      username TEXT UNIQUE NOT NULL,
      email TEXT UNIQUE NOT NULL,
      fullName TEXT NOT NULL,
      role TEXT NOT NULL, -- 'admin', 'manager', 'cashier'
      passwordHash TEXT NOT NULL,
      salt TEXT NOT NULL,
      isActive INTEGER NOT NULL DEFAULT 1,
      createdAt TEXT NOT NULL,
      updatedAt TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS business_settings (
      id TEXT PRIMARY KEY,
      businessName TEXT NOT NULL,
      tagline TEXT,
      phone TEXT,
      email TEXT,
      address TEXT,
      currencySymbol TEXT NOT NULL DEFAULT 'Rs',
      taxPercentage REAL NOT NULL DEFAULT 0,
      receiptFooter TEXT,
      invoicePrefix TEXT NOT NULL DEFAULT 'INV',
      lowStockDefaultThreshold INTEGER NOT NULL DEFAULT 10,
      theme TEXT NOT NULL DEFAULT 'light',
      logoDataUrl TEXT,
      updatedAt TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS customers (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      phone TEXT NOT NULL,
      email TEXT,
      address TEXT,
      category TEXT NOT NULL DEFAULT 'Retail', -- 'Retail', 'Wholesale', 'Corporate', 'Residential'
      openingBalance REAL NOT NULL DEFAULT 0,
      currentBalance REAL NOT NULL DEFAULT 0, -- positive = customer owes business (Udhaar)
      notes TEXT,
      isActive INTEGER NOT NULL DEFAULT 1,
      createdAt TEXT NOT NULL,
      updatedAt TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS categories (
      id TEXT PRIMARY KEY,
      name TEXT UNIQUE NOT NULL,
      description TEXT,
      createdAt TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS products (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      sku TEXT UNIQUE NOT NULL,
      categoryId TEXT,
      categoryName TEXT,
      costPrice REAL NOT NULL DEFAULT 0,
      sellingPrice REAL NOT NULL DEFAULT 0,
      stockQuantity REAL NOT NULL DEFAULT 0,
      unit TEXT NOT NULL DEFAULT 'Bottle', -- '19L Bottle', '1.5L Bottle', '500ml Bottle', 'Dispenser', 'Piece', etc.
      barcode TEXT,
      lowStockThreshold REAL NOT NULL DEFAULT 10,
      isActive INTEGER NOT NULL DEFAULT 1,
      createdAt TEXT NOT NULL,
      updatedAt TEXT NOT NULL,
      FOREIGN KEY (categoryId) REFERENCES categories(id) ON DELETE SET NULL
    );

    CREATE TABLE IF NOT EXISTS stock_movements (
      id TEXT PRIMARY KEY,
      productId TEXT NOT NULL,
      movementType TEXT NOT NULL, -- 'sale', 'purchase', 'adjustment', 'return'
      quantity REAL NOT NULL, -- positive for addition, negative for deduction
      previousStock REAL NOT NULL,
      newStock REAL NOT NULL,
      referenceId TEXT, -- invoiceId, purchaseId, etc.
      reason TEXT,
      createdByName TEXT,
      createdAt TEXT NOT NULL,
      FOREIGN KEY (productId) REFERENCES products(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS invoices (
      id TEXT PRIMARY KEY,
      invoiceNumber TEXT UNIQUE NOT NULL,
      customerId TEXT,
      customerName TEXT NOT NULL,
      customerPhone TEXT,
      customerAddress TEXT,
      isWalkIn INTEGER NOT NULL DEFAULT 0,
      subtotal REAL NOT NULL,
      discountType TEXT NOT NULL DEFAULT 'fixed', -- 'fixed' or 'percent'
      discountValue REAL NOT NULL DEFAULT 0,
      discountAmount REAL NOT NULL DEFAULT 0,
      taxAmount REAL NOT NULL DEFAULT 0,
      grandTotal REAL NOT NULL,
      paidAmount REAL NOT NULL DEFAULT 0,
      balanceAmount REAL NOT NULL DEFAULT 0,
      paymentMethod TEXT NOT NULL, -- 'Cash', 'Bank Transfer', 'Card', 'Mobile Wallet', 'Credit'
      paymentStatus TEXT NOT NULL, -- 'Paid', 'Partially Paid', 'Unpaid'
      notes TEXT,
      createdById TEXT,
      createdByName TEXT NOT NULL,
      isCancelled INTEGER NOT NULL DEFAULT 0,
      cancelReason TEXT,
      cancelledAt TEXT,
      cancelledByName TEXT,
      createdAt TEXT NOT NULL,
      updatedAt TEXT NOT NULL,
      FOREIGN KEY (customerId) REFERENCES customers(id) ON DELETE SET NULL
    );

    CREATE TABLE IF NOT EXISTS invoice_items (
      id TEXT PRIMARY KEY,
      invoiceId TEXT NOT NULL,
      productId TEXT NOT NULL,
      productName TEXT NOT NULL,
      sku TEXT,
      unit TEXT NOT NULL,
      unitPrice REAL NOT NULL,
      costPrice REAL NOT NULL DEFAULT 0,
      quantity REAL NOT NULL,
      discountAmount REAL NOT NULL DEFAULT 0,
      totalAmount REAL NOT NULL,
      FOREIGN KEY (invoiceId) REFERENCES invoices(id) ON DELETE CASCADE,
      FOREIGN KEY (productId) REFERENCES products(id)
    );

    CREATE TABLE IF NOT EXISTS payments (
      id TEXT PRIMARY KEY,
      receiptNumber TEXT UNIQUE NOT NULL,
      customerId TEXT NOT NULL,
      customerName TEXT NOT NULL,
      invoiceId TEXT,
      invoiceNumber TEXT,
      amount REAL NOT NULL,
      paymentMethod TEXT NOT NULL, -- 'Cash', 'Bank Transfer', 'Card', 'Mobile Wallet'
      referenceNumber TEXT,
      notes TEXT,
      createdById TEXT,
      createdByName TEXT NOT NULL,
      isVoided INTEGER NOT NULL DEFAULT 0,
      voidReason TEXT,
      voidedAt TEXT,
      voidedByName TEXT,
      createdAt TEXT NOT NULL,
      FOREIGN KEY (customerId) REFERENCES customers(id) ON DELETE CASCADE,
      FOREIGN KEY (invoiceId) REFERENCES invoices(id) ON DELETE SET NULL
    );

    CREATE TABLE IF NOT EXISTS customer_ledger (
      id TEXT PRIMARY KEY,
      customerId TEXT NOT NULL,
      transactionType TEXT NOT NULL, -- 'OPENING_BALANCE', 'INVOICE', 'PAYMENT', 'RETURN', 'ADJUSTMENT'
      referenceId TEXT, -- invoiceId or paymentId
      referenceNumber TEXT, -- e.g. INV-2026-0001, REC-2026-0001
      description TEXT NOT NULL,
      debit REAL NOT NULL DEFAULT 0, -- increases customer debt (charges/invoices)
      credit REAL NOT NULL DEFAULT 0, -- reduces customer debt (payments/returns)
      runningBalance REAL NOT NULL,
      paymentMethod TEXT,
      createdAt TEXT NOT NULL,
      FOREIGN KEY (customerId) REFERENCES customers(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS suppliers (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      company TEXT,
      phone TEXT NOT NULL,
      email TEXT,
      address TEXT,
      openingBalance REAL NOT NULL DEFAULT 0,
      currentBalance REAL NOT NULL DEFAULT 0, -- amount business owes supplier
      notes TEXT,
      isActive INTEGER NOT NULL DEFAULT 1,
      createdAt TEXT NOT NULL,
      updatedAt TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS purchases (
      id TEXT PRIMARY KEY,
      purchaseNumber TEXT UNIQUE NOT NULL,
      supplierId TEXT NOT NULL,
      supplierName TEXT NOT NULL,
      totalAmount REAL NOT NULL,
      paidAmount REAL NOT NULL DEFAULT 0,
      balanceAmount REAL NOT NULL DEFAULT 0,
      paymentStatus TEXT NOT NULL, -- 'Paid', 'Partially Paid', 'Unpaid'
      paymentMethod TEXT NOT NULL,
      notes TEXT,
      createdById TEXT,
      createdByName TEXT NOT NULL,
      createdAt TEXT NOT NULL,
      FOREIGN KEY (supplierId) REFERENCES suppliers(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS purchase_items (
      id TEXT PRIMARY KEY,
      purchaseId TEXT NOT NULL,
      productId TEXT NOT NULL,
      productName TEXT NOT NULL,
      unit TEXT NOT NULL,
      quantity REAL NOT NULL,
      unitCost REAL NOT NULL,
      totalAmount REAL NOT NULL,
      FOREIGN KEY (purchaseId) REFERENCES purchases(id) ON DELETE CASCADE,
      FOREIGN KEY (productId) REFERENCES products(id)
    );

    CREATE TABLE IF NOT EXISTS expenses (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      category TEXT NOT NULL, -- 'Rent', 'Electricity & Utilities', 'Fuel & Delivery', 'Maintenance', 'Salaries', 'Raw Materials / Bottles', 'Miscellaneous'
      amount REAL NOT NULL,
      paymentMethod TEXT NOT NULL,
      date TEXT NOT NULL,
      description TEXT,
      createdById TEXT,
      createdByName TEXT NOT NULL,
      createdAt TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS audit_logs (
      id TEXT PRIMARY KEY,
      userId TEXT,
      userName TEXT NOT NULL,
      action TEXT NOT NULL,
      module TEXT NOT NULL,
      targetId TEXT,
      details TEXT,
      ipAddress TEXT,
      createdAt TEXT NOT NULL
    );
  `);

  // Ensure default business settings row exists if empty
  const stmt = db.prepare('SELECT COUNT(*) as count FROM business_settings');
  const result = stmt.get() as { count: number };
  if (result.count === 0) {
    const insertSettings = db.prepare(`
      INSERT INTO business_settings (
        id, businessName, tagline, phone, email, address, currencySymbol, taxPercentage, receiptFooter, invoicePrefix, lowStockDefaultThreshold, theme, logoDataUrl, updatedAt
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    insertSettings.run(
      'default',
      'Freshway Water',
      'Pure & Refreshing Drinking Water Supply',
      '+92 300 1234567',
      'info@freshwaywater.com',
      'Main Commercial Area, Freshway Water Plant, Karachi, Pakistan',
      'Rs',
      0,
      'Thank you for choosing Freshway Water! Clean & Pure Water For Healthy Living.',
      'INV',
      10,
      'light',
      '',
      new Date().toISOString()
    );
  }
}

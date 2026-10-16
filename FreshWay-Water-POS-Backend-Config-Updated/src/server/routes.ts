import { Router } from 'express';
import { db, hashPassword, verifyPassword } from './db.ts';
import crypto from 'node:crypto';

export const apiRouter = Router();

// Helper to log audit events
export function logAudit(
  userId: string | null,
  userName: string,
  action: string,
  module: string,
  targetId: string | null,
  details: string,
  ipAddress?: string
) {
  try {
    const stmt = db.prepare(`
      INSERT INTO audit_logs (id, userId, userName, action, module, targetId, details, ipAddress, createdAt)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    stmt.run(
      crypto.randomUUID(),
      userId || null,
      userName || 'System',
      action,
      module,
      targetId || null,
      details,
      ipAddress || '127.0.0.1',
      new Date().toISOString()
    );
  } catch (e) {
    console.error('Audit log failed:', e);
  }
}

// -------------------------------------------------------------
// 1. AUTH & USER MANAGEMENT
// -------------------------------------------------------------

// Check if first-time admin setup is needed
apiRouter.get('/auth/status', (req, res) => {
  try {
    const countRow = db.prepare('SELECT COUNT(*) as userCount FROM users').get() as { userCount: number };
    const settings = db.prepare("SELECT * FROM business_settings WHERE id = 'default'").get();
    res.json({
      needsSetup: countRow.userCount === 0,
      userCount: countRow.userCount,
      settings: settings || null,
    });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// First-time Super Admin Setup
apiRouter.post('/auth/setup', (req, res) => {
  try {
    const countRow = db.prepare('SELECT COUNT(*) as userCount FROM users').get() as { userCount: number };
    if (countRow.userCount > 0) {
      return res.status(400).json({ error: 'System is already set up with an admin account. Please log in.' });
    }

    const { username, email, fullName, password, businessName, phone, address } = req.body;
    if (!username || !email || !fullName || !password) {
      return res.status(400).json({ error: 'Username, email, full name, and password are required.' });
    }

    if (password.length < 6) {
      return res.status(400).json({ error: 'Password must be at least 6 characters long.' });
    }

    const { hash, salt } = hashPassword(password);
    const userId = crypto.randomUUID();
    const now = new Date().toISOString();

    db.exec('BEGIN TRANSACTION;');
    try {
      const insertUser = db.prepare(`
        INSERT INTO users (id, username, email, fullName, role, passwordHash, salt, isActive, createdAt, updatedAt)
        VALUES (?, ?, ?, ?, 'admin', ?, ?, 1, ?, ?)
      `);
      insertUser.run(userId, username.trim().toLowerCase(), email.trim().toLowerCase(), fullName.trim(), hash, salt, now, now);

      if (businessName) {
        const updateSettings = db.prepare(`
          UPDATE business_settings SET businessName = ?, phone = ?, address = ?, updatedAt = ? WHERE id = 'default'
        `);
        updateSettings.run(businessName, phone || '', address || '', now);
      }

      db.exec('COMMIT;');

      logAudit(userId, fullName, 'SETUP_ADMIN', 'AUTH', userId, `Super admin created: ${username}`);

      res.json({
        success: true,
        user: {
          id: userId,
          username: username.trim().toLowerCase(),
          email: email.trim().toLowerCase(),
          fullName: fullName.trim(),
          role: 'admin',
        },
      });
    } catch (e: any) {
      db.exec('ROLLBACK;');
      throw e;
    }
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// Login
apiRouter.post('/auth/login', (req, res) => {
  try {
    const { username, password } = req.body;
    if (!username || !password) {
      return res.status(400).json({ error: 'Please enter both username/email and password.' });
    }

    const user = db.prepare(`
      SELECT * FROM users WHERE LOWER(username) = LOWER(?) OR LOWER(email) = LOWER(?)
    `).get(username.trim(), username.trim()) as any;

    if (!user) {
      return res.status(401).json({ error: 'Invalid username or password.' });
    }

    if (!user.isActive) {
      return res.status(403).json({ error: 'This account has been deactivated. Please contact the administrator.' });
    }

    const isValid = verifyPassword(password, user.passwordHash, user.salt);
    if (!isValid) {
      return res.status(401).json({ error: 'Invalid username or password.' });
    }

    logAudit(user.id, user.fullName, 'LOGIN', 'AUTH', user.id, `User logged in successfully`);

    res.json({
      success: true,
      user: {
        id: user.id,
        username: user.username,
        email: user.email,
        fullName: user.fullName,
        role: user.role,
      },
    });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// Get all users (Admin only)
apiRouter.get('/users', (req, res) => {
  try {
    const users = db.prepare(`
      SELECT id, username, email, fullName, role, isActive, createdAt, updatedAt FROM users ORDER BY createdAt ASC
    `).all();
    res.json(users);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// Create new user (Admin only)
apiRouter.post('/users', (req, res) => {
  try {
    const { username, email, fullName, password, role, adminName, adminId } = req.body;
    if (!username || !email || !fullName || !password || !role) {
      return res.status(400).json({ error: 'All fields are required.' });
    }

    const existing = db.prepare(`
      SELECT id FROM users WHERE LOWER(username) = LOWER(?) OR LOWER(email) = LOWER(?)
    `).get(username.trim(), email.trim());
    if (existing) {
      return res.status(400).json({ error: 'A user with this username or email already exists.' });
    }

    const { hash, salt } = hashPassword(password);
    const userId = crypto.randomUUID();
    const now = new Date().toISOString();

    const insertUser = db.prepare(`
      INSERT INTO users (id, username, email, fullName, role, passwordHash, salt, isActive, createdAt, updatedAt)
      VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?, ?)
    `);
    insertUser.run(userId, username.trim().toLowerCase(), email.trim().toLowerCase(), fullName.trim(), role, hash, salt, now, now);

    logAudit(adminId, adminName || 'Admin', 'CREATE_USER', 'USERS', userId, `Created user ${username} with role ${role}`);

    res.json({
      success: true,
      user: { id: userId, username, email, fullName, role, isActive: 1 },
    });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// Update user / status / password
apiRouter.put('/users/:id', (req, res) => {
  try {
    const { id } = req.params;
    const { fullName, role, isActive, password, adminName, adminId } = req.body;

    const user = db.prepare('SELECT * FROM users WHERE id = ?').get(id) as any;
    if (!user) {
      return res.status(404).json({ error: 'User not found.' });
    }

    const now = new Date().toISOString();

    if (password && password.trim().length >= 6) {
      const { hash, salt } = hashPassword(password.trim());
      db.prepare(`
        UPDATE users SET fullName = ?, role = ?, isActive = ?, passwordHash = ?, salt = ?, updatedAt = ? WHERE id = ?
      `).run(fullName || user.fullName, role || user.role, isActive !== undefined ? isActive : user.isActive, hash, salt, now, id);
    } else {
      db.prepare(`
        UPDATE users SET fullName = ?, role = ?, isActive = ?, updatedAt = ? WHERE id = ?
      `).run(fullName || user.fullName, role || user.role, isActive !== undefined ? isActive : user.isActive, now, id);
    }

    logAudit(adminId, adminName || 'Admin', 'UPDATE_USER', 'USERS', id, `Updated user ${user.username}`);

    res.json({ success: true });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// -------------------------------------------------------------
// 2. CUSTOMERS & LEDGER
// -------------------------------------------------------------

// List customers
apiRouter.get('/customers', (req, res) => {
  try {
    const { search, category, status } = req.query;
    let query = 'SELECT * FROM customers WHERE 1=1';
    const params: any[] = [];

    if (search) {
      query += ' AND (name LIKE ? OR phone LIKE ? OR id LIKE ?)';
      const s = `%${search}%`;
      params.push(s, s, s);
    }
    if (category && category !== 'All') {
      query += ' AND category = ?';
      params.push(category);
    }
    if (status === 'active') {
      query += ' AND isActive = 1';
    } else if (status === 'archived') {
      query += ' AND isActive = 0';
    }

    query += ' ORDER BY name ASC';
    const rows = db.prepare(query).all(...params);
    res.json(rows);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// Create Customer
apiRouter.post('/customers', (req, res) => {
  try {
    const { name, phone, email, address, category, openingBalance, notes, createdByName, createdById } = req.body;
    if (!name || !phone) {
      return res.status(400).json({ error: 'Customer name and phone number are required.' });
    }

    // Check duplicate phone
    const existing = db.prepare('SELECT id, name FROM customers WHERE phone = ?').get(phone.trim()) as any;
    if (existing) {
      return res.status(409).json({
        error: `Customer with phone ${phone} already exists (${existing.name}).`,
        existingId: existing.id,
      });
    }

    // Generate readable ID: CUST-0001
    const countRow = db.prepare('SELECT COUNT(*) as c FROM customers').get() as { c: number };
    const custId = `CUST-${String(countRow.c + 1).padStart(4, '0')}`;
    const openBal = parseFloat(openingBalance) || 0;
    const now = new Date().toISOString();

    db.exec('BEGIN TRANSACTION;');
    try {
      const insertCustomer = db.prepare(`
        INSERT INTO customers (id, name, phone, email, address, category, openingBalance, currentBalance, notes, isActive, createdAt, updatedAt)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?)
      `);
      insertCustomer.run(
        custId,
        name.trim(),
        phone.trim(),
        email ? email.trim() : '',
        address ? address.trim() : '',
        category || 'Retail',
        openBal,
        openBal, // Initial balance is the opening balance
        notes || '',
        now,
        now
      );

      // Record Opening Balance in Ledger if > 0
      if (openBal !== 0) {
        const insertLedger = db.prepare(`
          INSERT INTO customer_ledger (id, customerId, transactionType, referenceId, referenceNumber, description, debit, credit, runningBalance, paymentMethod, createdAt)
          VALUES (?, ?, 'OPENING_BALANCE', NULL, 'OPEN-BAL', 'Opening Account Balance', ?, 0, ?, 'Account', ?)
        `);
        insertLedger.run(crypto.randomUUID(), custId, openBal, openBal, now);
      }

      db.exec('COMMIT;');

      logAudit(createdById, createdByName || 'User', 'CREATE_CUSTOMER', 'CUSTOMERS', custId, `Added customer ${name} with opening balance Rs ${openBal}`);

      res.status(201).json({
        id: custId,
        name: name.trim(),
        phone: phone.trim(),
        category: category || 'Retail',
        currentBalance: openBal,
      });
    } catch (e: any) {
      db.exec('ROLLBACK;');
      throw e;
    }
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// Update Customer
apiRouter.put('/customers/:id', (req, res) => {
  try {
    const { id } = req.params;
    const { name, phone, email, address, category, notes, isActive, updatedByName, updatedById } = req.body;

    const existing = db.prepare('SELECT * FROM customers WHERE id = ?').get(id) as any;
    if (!existing) {
      return res.status(404).json({ error: 'Customer not found.' });
    }

    const now = new Date().toISOString();
    const update = db.prepare(`
      UPDATE customers SET name = ?, phone = ?, email = ?, address = ?, category = ?, notes = ?, isActive = ?, updatedAt = ? WHERE id = ?
    `);
    update.run(
      name !== undefined ? name.trim() : existing.name,
      phone !== undefined ? phone.trim() : existing.phone,
      email !== undefined ? email.trim() : existing.email,
      address !== undefined ? address.trim() : existing.address,
      category !== undefined ? category : existing.category,
      notes !== undefined ? notes : existing.notes,
      isActive !== undefined ? isActive : existing.isActive,
      now,
      id
    );

    logAudit(updatedById, updatedByName || 'User', 'UPDATE_CUSTOMER', 'CUSTOMERS', id, `Updated customer ${name || existing.name}`);

    res.json({ success: true });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// Get Single Customer details + balance
apiRouter.get('/customers/:id', (req, res) => {
  try {
    const { id } = req.params;
    const customer = db.prepare('SELECT * FROM customers WHERE id = ?').get(id) as any;
    if (!customer) {
      return res.status(404).json({ error: 'Customer not found.' });
    }
    res.json(customer);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// -------------------------------------------------------------
// 3. MONTHLY CUSTOMER BILLING & LEDGER — CORE ACCURATE ENGINE
// -------------------------------------------------------------

apiRouter.get('/customers/:id/monthly-summary', (req, res) => {
  try {
    const { id } = req.params;
    const { month, year, startDate: customStart, endDate: customEnd } = req.query;

    const customer = db.prepare('SELECT * FROM customers WHERE id = ?').get(id) as any;
    if (!customer) {
      return res.status(404).json({ error: 'Customer not found.' });
    }

    // Determine date boundaries
    let periodStart: string;
    let periodEnd: string;
    let periodLabel: string;

    if (customStart && customEnd) {
      periodStart = `${customStart}T00:00:00.000Z`;
      periodEnd = `${customEnd}T23:59:59.999Z`;
      periodLabel = `${customStart} to ${customEnd}`;
    } else {
      const selectedYear = parseInt(year as string, 10) || new Date().getFullYear();
      const selectedMonth = parseInt(month as string, 10) || new Date().getMonth() + 1; // 1-12
      const start = new Date(Date.UTC(selectedYear, selectedMonth - 1, 1, 0, 0, 0));
      const end = new Date(Date.UTC(selectedYear, selectedMonth, 0, 23, 59, 59, 999));
      periodStart = start.toISOString();
      periodEnd = end.toISOString();
      periodLabel = start.toLocaleString('en-US', { month: 'long', year: 'numeric', timeZone: 'UTC' });
    }

    // 1. Calculate opening balance strictly before periodStart:
    // Opening balance = Opening Balance set at creation + (Debits before periodStart - Credits before periodStart)
    const priorLedger = db.prepare(`
      SELECT COALESCE(SUM(debit), 0) as priorDebits, COALESCE(SUM(credit), 0) as priorCredits
      FROM customer_ledger
      WHERE customerId = ? AND createdAt < ?
    `).get(id, periodStart) as { priorDebits: number; priorCredits: number };

    // If opening_balance transaction is already in customer_ledger, priorDebits covers it.
    // Let's verify whether openingBalance is recorded in customer_ledger as OPENING_BALANCE
    const openingBal = priorLedger.priorDebits - priorLedger.priorCredits;

    // 2. Fetch period invoices for this customer
    const invoices = db.prepare(`
      SELECT * FROM invoices
      WHERE customerId = ? AND isCancelled = 0 AND createdAt >= ? AND createdAt <= ?
      ORDER BY createdAt ASC
    `).all(id, periodStart, periodEnd) as any[];

    // Fetch items quantity sold in this period
    const totalQtyRow = db.prepare(`
      SELECT COALESCE(SUM(ii.quantity), 0) as totalQuantity
      FROM invoice_items ii
      JOIN invoices i ON ii.invoiceId = i.id
      WHERE i.customerId = ? AND i.isCancelled = 0 AND i.createdAt >= ? AND i.createdAt <= ?
    `).get(id, periodStart, periodEnd) as { totalQuantity: number };

    let grossSales = 0;
    let discounts = 0;
    let netSales = 0;
    let directCashPaidAtSale = 0; // paid immediately on spot

    for (const inv of invoices) {
      grossSales += inv.subtotal;
      discounts += inv.discountAmount;
      netSales += inv.grandTotal;
      // If paid partially or fully during invoice creation
      if (inv.paidAmount > 0) {
        directCashPaidAtSale += inv.paidAmount;
      }
    }

    // 3. Fetch all payments received during period
    const payments = db.prepare(`
      SELECT * FROM payments
      WHERE customerId = ? AND isVoided = 0 AND createdAt >= ? AND createdAt <= ?
      ORDER BY createdAt ASC
    `).all(id, periodStart, periodEnd) as any[];

    const totalPaymentsReceivedInPeriod = payments.reduce((sum, p) => sum + p.amount, 0);

    // 4. Fetch period ledger entries
    const ledgerEntries = db.prepare(`
      SELECT * FROM customer_ledger
      WHERE customerId = ? AND createdAt >= ? AND createdAt <= ?
      ORDER BY createdAt ASC
    `).all(id, periodStart, periodEnd) as any[];

    // Period debits (invoices charges) and credits (payments)
    let periodDebits = 0;
    let periodCredits = 0;
    for (const entry of ledgerEntries) {
      periodDebits += entry.debit;
      periodCredits += entry.credit;
    }

    // Total Amount Due = Opening Balance + Period Debits
    // Closing Balance = Opening Balance + Period Debits - Period Credits
    const totalAmountDue = openingBal + periodDebits;
    const closingBalance = openingBal + periodDebits - periodCredits;

    res.json({
      customer: {
        id: customer.id,
        name: customer.name,
        phone: customer.phone,
        email: customer.email,
        address: customer.address,
        category: customer.category,
        overallBalance: customer.currentBalance,
      },
      period: {
        label: periodLabel,
        startDate: periodStart,
        endDate: periodEnd,
      },
      summary: {
        openingBalance: openingBal,
        invoiceCount: invoices.length,
        totalQuantitySold: totalQtyRow.totalQuantity || 0,
        grossSales,
        discounts,
        returns: 0,
        netSales,
        paymentsReceived: totalPaymentsReceivedInPeriod,
        directCashPaidAtSale,
        previousUnpaidBalance: openingBal,
        totalAmountDue,
        closingBalance,
      },
      invoices,
      payments,
      ledgerEntries,
    });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// Full Ledger with calculated running balance
apiRouter.get('/customers/:id/ledger', (req, res) => {
  try {
    const { id } = req.params;
    const { startDate, endDate } = req.query;

    const customer = db.prepare('SELECT * FROM customers WHERE id = ?').get(id) as any;
    if (!customer) {
      return res.status(404).json({ error: 'Customer not found.' });
    }

    let query = 'SELECT * FROM customer_ledger WHERE customerId = ?';
    const params: any[] = [id];

    if (startDate) {
      query += ' AND createdAt >= ?';
      params.push(`${startDate}T00:00:00.000Z`);
    }
    if (endDate) {
      query += ' AND createdAt <= ?';
      params.push(`${endDate}T23:59:59.999Z`);
    }

    query += ' ORDER BY createdAt ASC';
    const entries = db.prepare(query).all(...params);

    res.json({
      customer,
      entries,
    });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// -------------------------------------------------------------
// 4. PRODUCTS & INVENTORY
// -------------------------------------------------------------

apiRouter.get('/products', (req, res) => {
  try {
    const { search, category, lowStock } = req.query;
    let query = 'SELECT * FROM products WHERE isActive = 1';
    const params: any[] = [];

    if (search) {
      query += ' AND (name LIKE ? OR sku LIKE ? OR barcode LIKE ?)';
      const s = `%${search}%`;
      params.push(s, s, s);
    }
    if (category && category !== 'All') {
      query += ' AND categoryName = ?';
      params.push(category);
    }
    if (lowStock === 'true') {
      query += ' AND stockQuantity <= lowStockThreshold';
    }

    query += ' ORDER BY name ASC';
    const rows = db.prepare(query).all(...params);
    res.json(rows);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

apiRouter.post('/products', (req, res) => {
  try {
    const { name, sku, categoryName, costPrice, sellingPrice, stockQuantity, unit, barcode, lowStockThreshold, createdByName, createdById } = req.body;
    if (!name || !sellingPrice) {
      return res.status(400).json({ error: 'Product name and selling price are required.' });
    }

    // Auto-generate SKU if omitted
    let finalSku = sku ? sku.trim() : '';
    if (!finalSku) {
      const pCount = db.prepare('SELECT COUNT(*) as c FROM products').get() as { c: number };
      finalSku = `PROD-${String(pCount.c + 1).padStart(4, '0')}`;
    }

    const existing = db.prepare('SELECT id FROM products WHERE sku = ?').get(finalSku);
    if (existing) {
      return res.status(400).json({ error: `Product with SKU ${finalSku} already exists.` });
    }

    const prodId = crypto.randomUUID();
    const now = new Date().toISOString();
    const initStock = parseFloat(stockQuantity) || 0;
    const cost = parseFloat(costPrice) || 0;
    const sell = parseFloat(sellingPrice) || 0;
    const lowThreshold = parseFloat(lowStockThreshold) || 10;

    db.exec('BEGIN TRANSACTION;');
    try {
      const insert = db.prepare(`
        INSERT INTO products (id, name, sku, categoryName, costPrice, sellingPrice, stockQuantity, unit, barcode, lowStockThreshold, isActive, createdAt, updatedAt)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?)
      `);
      insert.run(
        prodId,
        name.trim(),
        finalSku,
        categoryName || 'General',
        cost,
        sell,
        initStock,
        unit || 'Bottle',
        barcode || '',
        lowThreshold,
        now,
        now
      );

      // Record initial stock movement if > 0
      if (initStock > 0) {
        db.prepare(`
          INSERT INTO stock_movements (id, productId, movementType, quantity, previousStock, newStock, referenceId, reason, createdByName, createdAt)
          VALUES (?, ?, 'adjustment', ?, 0, ?, 'INITIAL', 'Initial stock entry', ?, ?)
        `).run(crypto.randomUUID(), prodId, initStock, initStock, createdByName || 'User', now);
      }

      db.exec('COMMIT;');

      logAudit(createdById, createdByName || 'User', 'CREATE_PRODUCT', 'INVENTORY', prodId, `Added product ${name} (SKU: ${finalSku}) with stock ${initStock}`);

      res.status(201).json({ success: true, id: prodId, sku: finalSku });
    } catch (e: any) {
      db.exec('ROLLBACK;');
      throw e;
    }
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

apiRouter.put('/products/:id', (req, res) => {
  try {
    const { id } = req.params;
    const { name, sku, categoryName, costPrice, sellingPrice, unit, barcode, lowStockThreshold, updatedByName, updatedById } = req.body;

    const prod = db.prepare('SELECT * FROM products WHERE id = ?').get(id) as any;
    if (!prod) {
      return res.status(404).json({ error: 'Product not found.' });
    }

    const now = new Date().toISOString();
    db.prepare(`
      UPDATE products SET name = ?, sku = ?, categoryName = ?, costPrice = ?, sellingPrice = ?, unit = ?, barcode = ?, lowStockThreshold = ?, updatedAt = ? WHERE id = ?
    `).run(
      name !== undefined ? name.trim() : prod.name,
      sku !== undefined ? sku.trim() : prod.sku,
      categoryName !== undefined ? categoryName : prod.categoryName,
      costPrice !== undefined ? parseFloat(costPrice) : prod.costPrice,
      sellingPrice !== undefined ? parseFloat(sellingPrice) : prod.sellingPrice,
      unit !== undefined ? unit : prod.unit,
      barcode !== undefined ? barcode : prod.barcode,
      lowStockThreshold !== undefined ? parseFloat(lowStockThreshold) : prod.lowStockThreshold,
      now,
      id
    );

    logAudit(updatedById, updatedByName || 'User', 'UPDATE_PRODUCT', 'INVENTORY', id, `Updated product details for ${name || prod.name}`);

    res.json({ success: true });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// Manual Stock Adjustment with mandatory reason
apiRouter.post('/products/:id/adjust-stock', (req, res) => {
  try {
    const { id } = req.params;
    const { adjustmentQuantity, reason, userRole, createdByName, createdById } = req.body;

    if (!reason || reason.trim().length === 0) {
      return res.status(400).json({ error: 'A valid reason is required for manual stock adjustment.' });
    }

    const prod = db.prepare('SELECT * FROM products WHERE id = ?').get(id) as any;
    if (!prod) {
      return res.status(404).json({ error: 'Product not found.' });
    }

    const adjQty = parseFloat(adjustmentQuantity);
    if (isNaN(adjQty) || adjQty === 0) {
      return res.status(400).json({ error: 'Please enter a valid non-zero adjustment quantity.' });
    }

    const newStock = prod.stockQuantity + adjQty;
    if (newStock < 0 && userRole !== 'admin') {
      return res.status(400).json({ error: 'Negative stock is not permitted unless authorized by an Admin.' });
    }

    const now = new Date().toISOString();
    db.exec('BEGIN TRANSACTION;');
    try {
      db.prepare('UPDATE products SET stockQuantity = ?, updatedAt = ? WHERE id = ?').run(newStock, now, id);

      db.prepare(`
        INSERT INTO stock_movements (id, productId, movementType, quantity, previousStock, newStock, referenceId, reason, createdByName, createdAt)
        VALUES (?, ?, 'adjustment', ?, ?, ?, 'MANUAL_ADJ', ?, ?, ?)
      `).run(crypto.randomUUID(), id, adjQty, prod.stockQuantity, newStock, reason.trim(), createdByName || 'User', now);

      db.exec('COMMIT;');

      logAudit(createdById, createdByName || 'User', 'ADJUST_STOCK', 'INVENTORY', id, `Adjusted stock for ${prod.name} by ${adjQty} (${reason.trim()})`);

      res.json({ success: true, newStock });
    } catch (e: any) {
      db.exec('ROLLBACK;');
      throw e;
    }
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// Product stock movements history
apiRouter.get('/products/:id/movements', (req, res) => {
  try {
    const { id } = req.params;
    const rows = db.prepare('SELECT * FROM stock_movements WHERE productId = ? ORDER BY createdAt DESC LIMIT 100').all(id);
    res.json(rows);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// -------------------------------------------------------------
// 5. INVOICES & FAST POS BILLING
// -------------------------------------------------------------

apiRouter.get('/invoices', (req, res) => {
  try {
    const { search, customerId, status, startDate, endDate, limit, offset } = req.query;
    let query = 'SELECT * FROM invoices WHERE 1=1';
    const params: any[] = [];

    if (search) {
      query += ' AND (invoiceNumber LIKE ? OR customerName LIKE ? OR customerPhone LIKE ?)';
      const s = `%${search}%`;
      params.push(s, s, s);
    }
    if (customerId) {
      query += ' AND customerId = ?';
      params.push(customerId);
    }
    if (status && status !== 'All') {
      if (status === 'Cancelled') {
        query += ' AND isCancelled = 1';
      } else {
        query += ' AND paymentStatus = ? AND isCancelled = 0';
        params.push(status);
      }
    }
    if (startDate) {
      query += ' AND createdAt >= ?';
      params.push(`${startDate}T00:00:00.000Z`);
    }
    if (endDate) {
      query += ' AND createdAt <= ?';
      params.push(`${endDate}T23:59:59.999Z`);
    }

    query += ' ORDER BY createdAt DESC';
    const lim = parseInt(limit as string, 10) || 50;
    const off = parseInt(offset as string, 10) || 0;
    query += ` LIMIT ${lim} OFFSET ${off}`;

    const invoices = db.prepare(query).all(...params);
    res.json(invoices);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

apiRouter.get('/invoices/:id', (req, res) => {
  try {
    const { id } = req.params;
    const invoice = db.prepare('SELECT * FROM invoices WHERE id = ?').get(id) as any;
    if (!invoice) {
      return res.status(404).json({ error: 'Invoice not found.' });
    }
    const items = db.prepare('SELECT * FROM invoice_items WHERE invoiceId = ?').all(id);
    const payments = db.prepare('SELECT * FROM payments WHERE invoiceId = ? AND isVoided = 0').all(id);
    res.json({ ...invoice, items, payments });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// Atomic Invoice Creation (POST POS Sale)
apiRouter.post('/invoices', (req, res) => {
  try {
    const {
      customerId,
      customerName,
      customerPhone,
      customerAddress,
      isWalkIn,
      items,
      subtotal,
      discountType,
      discountValue,
      discountAmount,
      taxAmount,
      grandTotal,
      paidAmount,
      paymentMethod,
      notes,
      createdByName,
      createdById,
    } = req.body;

    if (!items || !Array.isArray(items) || items.length === 0) {
      return res.status(400).json({ error: 'Invoice must contain at least one product item.' });
    }

    const now = new Date().toISOString();
    const invoiceId = crypto.randomUUID();

    // Generate unique sequential invoice number: INV-2026-0001
    const currentYear = new Date().getFullYear();
    const countRow = db.prepare("SELECT COUNT(*) as c FROM invoices WHERE invoiceNumber LIKE ?").get(`INV-${currentYear}-%`) as { c: number };
    const invoiceNumber = `INV-${currentYear}-${String(countRow.c + 1).padStart(4, '0')}`;

    const paid = parseFloat(paidAmount) || 0;
    const total = parseFloat(grandTotal) || 0;
    const balance = Math.max(0, total - paid);

    let paymentStatus = 'Unpaid';
    if (paid >= total) {
      paymentStatus = 'Paid';
    } else if (paid > 0) {
      paymentStatus = 'Partially Paid';
    }

    db.exec('BEGIN TRANSACTION;');
    try {
      // 1. Insert invoice header
      const insertInv = db.prepare(`
        INSERT INTO invoices (
          id, invoiceNumber, customerId, customerName, customerPhone, customerAddress, isWalkIn,
          subtotal, discountType, discountValue, discountAmount, taxAmount, grandTotal,
          paidAmount, balanceAmount, paymentMethod, paymentStatus, notes, createdById, createdByName,
          isCancelled, createdAt, updatedAt
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?)
      `);
      insertInv.run(
        invoiceId,
        invoiceNumber,
        isWalkIn ? null : (customerId || null),
        customerName || (isWalkIn ? 'Walk-in Customer' : 'Customer'),
        customerPhone || '',
        customerAddress || '',
        isWalkIn ? 1 : 0,
        subtotal || 0,
        discountType || 'fixed',
        discountValue || 0,
        discountAmount || 0,
        taxAmount || 0,
        total,
        paid,
        balance,
        paymentMethod || 'Cash',
        paymentStatus,
        notes || '',
        createdById || null,
        createdByName || 'Staff',
        now,
        now
      );

      // 2. Insert invoice items & deduct stock
      const insertItem = db.prepare(`
        INSERT INTO invoice_items (id, invoiceId, productId, productName, sku, unit, unitPrice, costPrice, quantity, discountAmount, totalAmount)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);
      const updateStock = db.prepare('UPDATE products SET stockQuantity = stockQuantity - ?, updatedAt = ? WHERE id = ?');
      const insertMovement = db.prepare(`
        INSERT INTO stock_movements (id, productId, movementType, quantity, previousStock, newStock, referenceId, reason, createdByName, createdAt)
        VALUES (?, ?, 'sale', ?, ?, ?, ?, ?, ?, ?)
      `);

      for (const it of items) {
        const itemId = crypto.randomUUID();
        const prod = db.prepare('SELECT stockQuantity, costPrice FROM products WHERE id = ?').get(it.productId) as any;
        const currentStock = prod ? prod.stockQuantity : 0;
        const costPrice = prod ? prod.costPrice : (it.costPrice || 0);
        const itemQty = parseFloat(it.quantity) || 1;
        const itemTotal = parseFloat(it.totalAmount) || (it.unitPrice * itemQty);

        insertItem.run(
          itemId,
          invoiceId,
          it.productId,
          it.productName,
          it.sku || '',
          it.unit || 'Bottle',
          it.unitPrice,
          costPrice,
          itemQty,
          it.discountAmount || 0,
          itemTotal
        );

        // Deduct stock
        updateStock.run(itemQty, now, it.productId);

        // Record stock movement
        insertMovement.run(
          crypto.randomUUID(),
          it.productId,
          -itemQty,
          currentStock,
          currentStock - itemQty,
          invoiceNumber,
          `Sale Invoice ${invoiceNumber}`,
          createdByName || 'Staff',
          now
        );
      }

      // 3. Customer Ledger Management (Only if registered customer, not Walk-in)
      if (!isWalkIn && customerId) {
        const cust = db.prepare('SELECT currentBalance FROM customers WHERE id = ?').get(customerId) as any;
        if (cust) {
          // Debit transaction: customer is charged the invoice total
          const newBalanceAfterDebit = cust.currentBalance + total;
          db.prepare(`
            INSERT INTO customer_ledger (id, customerId, transactionType, referenceId, referenceNumber, description, debit, credit, runningBalance, paymentMethod, createdAt)
            VALUES (?, ?, 'INVOICE', ?, ?, ?, ?, 0, ?, ?, ?)
          `).run(
            crypto.randomUUID(),
            customerId,
            invoiceId,
            invoiceNumber,
            `Invoice ${invoiceNumber} - Grand Total: Rs ${total}`,
            total,
            newBalanceAfterDebit,
            paymentMethod,
            now
          );

          let finalCustBal = newBalanceAfterDebit;

          // If payment was made at checkout, record payment and credit the ledger
          if (paid > 0) {
            const receiptCount = db.prepare("SELECT COUNT(*) as c FROM payments WHERE receiptNumber LIKE ?").get(`REC-${currentYear}-%`) as { c: number };
            const receiptNumber = `REC-${currentYear}-${String(receiptCount.c + 1).padStart(4, '0')}`;
            const paymentId = crypto.randomUUID();

            db.prepare(`
              INSERT INTO payments (id, receiptNumber, customerId, customerName, invoiceId, invoiceNumber, amount, paymentMethod, referenceNumber, notes, createdById, createdByName, isVoided, createdAt)
              VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?)
            `).run(
              paymentId,
              receiptNumber,
              customerId,
              customerName,
              invoiceId,
              invoiceNumber,
              paid,
              paymentMethod,
              invoiceNumber,
              `Paid at sale checkout for ${invoiceNumber}`,
              createdById || null,
              createdByName || 'Staff',
              now
            );

            finalCustBal = newBalanceAfterDebit - paid;

            db.prepare(`
              INSERT INTO customer_ledger (id, customerId, transactionType, referenceId, referenceNumber, description, debit, credit, runningBalance, paymentMethod, createdAt)
              VALUES (?, ?, 'PAYMENT', ?, ?, ?, 0, ?, ?, ?, ?)
            `).run(
              crypto.randomUUID(),
              customerId,
              paymentId,
              receiptNumber,
              `Payment received for ${invoiceNumber}`,
              paid,
              finalCustBal,
              paymentMethod,
              now
            );
          }

          // Update customer balance to final current balance
          db.prepare('UPDATE customers SET currentBalance = ?, updatedAt = ? WHERE id = ?').run(finalCustBal, now, customerId);
        }
      }

      db.exec('COMMIT;');

      logAudit(createdById, createdByName || 'Staff', 'CREATE_INVOICE', 'POS', invoiceId, `Created ${invoiceNumber} for ${customerName} (Total: Rs ${total}, Paid: Rs ${paid})`);

      res.status(201).json({
        success: true,
        invoiceId,
        invoiceNumber,
        grandTotal: total,
        paidAmount: paid,
        balanceAmount: balance,
        paymentStatus,
      });
    } catch (e: any) {
      db.exec('ROLLBACK;');
      throw e;
    }
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// Cancel / Void Invoice (Admin or Manager only, with audit trail and stock restore)
apiRouter.post('/invoices/:id/cancel', (req, res) => {
  try {
    const { id } = req.params;
    const { reason, userRole, cancelledByName, cancelledById } = req.body;

    if (!reason || reason.trim().length === 0) {
      return res.status(400).json({ error: 'Cancellation reason is required.' });
    }
    if (userRole === 'cashier') {
      return res.status(403).json({ error: 'Cashier staff is not permitted to cancel invoices. Contact Manager or Admin.' });
    }

    const invoice = db.prepare('SELECT * FROM invoices WHERE id = ?').get(id) as any;
    if (!invoice) {
      return res.status(404).json({ error: 'Invoice not found.' });
    }
    if (invoice.isCancelled) {
      return res.status(400).json({ error: 'Invoice is already cancelled.' });
    }

    const items = db.prepare('SELECT * FROM invoice_items WHERE invoiceId = ?').all(id) as any[];
    const now = new Date().toISOString();

    db.exec('BEGIN TRANSACTION;');
    try {
      // 1. Mark invoice cancelled
      db.prepare(`
        UPDATE invoices SET isCancelled = 1, cancelReason = ?, cancelledAt = ?, cancelledByName = ?, updatedAt = ? WHERE id = ?
      `).run(reason.trim(), now, cancelledByName || 'Admin', now, id);

      // 2. Restore inventory stock
      for (const item of items) {
        const prod = db.prepare('SELECT stockQuantity FROM products WHERE id = ?').get(item.productId) as any;
        const currentStock = prod ? prod.stockQuantity : 0;
        db.prepare('UPDATE products SET stockQuantity = stockQuantity + ?, updatedAt = ? WHERE id = ?').run(item.quantity, now, item.productId);

        db.prepare(`
          INSERT INTO stock_movements (id, productId, movementType, quantity, previousStock, newStock, referenceId, reason, createdByName, createdAt)
          VALUES (?, ?, 'return', ?, ?, ?, ?, ?, ?, ?)
        `).run(
          crypto.randomUUID(),
          item.productId,
          item.quantity,
          currentStock,
          currentStock + item.quantity,
          invoice.invoiceNumber,
          `Cancelled invoice ${invoice.invoiceNumber}: ${reason.trim()}`,
          cancelledByName || 'Admin',
          now
        );
      }

      // 3. Reverse customer ledger and balance if registered customer
      if (invoice.customerId) {
        const cust = db.prepare('SELECT currentBalance FROM customers WHERE id = ?').get(invoice.customerId) as any;
        if (cust) {
          // If invoice had an unpaid balance, credit the remaining balance back
          // If invoice was partially or fully paid, we reverse the debit charge and any checkout payment
          const netAdjustment = invoice.grandTotal - invoice.paidAmount; // this was added to Udhaar
          const newBal = cust.currentBalance - netAdjustment;

          db.prepare(`
            INSERT INTO customer_ledger (id, customerId, transactionType, referenceId, referenceNumber, description, debit, credit, runningBalance, paymentMethod, createdAt)
            VALUES (?, ?, 'RETURN', ?, ?, ?, 0, ?, ?, 'Adjustment', ?)
          `).run(
            crypto.randomUUID(),
            invoice.customerId,
            invoice.id,
            invoice.invoiceNumber,
            `Cancellation of ${invoice.invoiceNumber} (${reason.trim()})`,
            netAdjustment,
            newBal,
            now
          );

          db.prepare('UPDATE customers SET currentBalance = ?, updatedAt = ? WHERE id = ?').run(newBal, now, invoice.customerId);
        }
      }

      db.exec('COMMIT;');

      logAudit(cancelledById, cancelledByName || 'Admin', 'CANCEL_INVOICE', 'INVOICES', id, `Cancelled invoice ${invoice.invoiceNumber}: ${reason.trim()}`);

      res.json({ success: true, message: `Invoice ${invoice.invoiceNumber} has been safely cancelled.` });
    } catch (e: any) {
      db.exec('ROLLBACK;');
      throw e;
    }
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// -------------------------------------------------------------
// 6. PAYMENTS & UDHAAR COLLECTION MODULE
// -------------------------------------------------------------

apiRouter.get('/payments', (req, res) => {
  try {
    const { customerId, invoiceId, startDate, endDate } = req.query;
    let query = 'SELECT * FROM payments WHERE isVoided = 0';
    const params: any[] = [];

    if (customerId) {
      query += ' AND customerId = ?';
      params.push(customerId);
    }
    if (invoiceId) {
      query += ' AND invoiceId = ?';
      params.push(invoiceId);
    }
    if (startDate) {
      query += ' AND createdAt >= ?';
      params.push(`${startDate}T00:00:00.000Z`);
    }
    if (endDate) {
      query += ' AND createdAt <= ?';
      params.push(`${endDate}T23:59:59.999Z`);
    }

    query += ' ORDER BY createdAt DESC LIMIT 100';
    const rows = db.prepare(query).all(...params);
    res.json(rows);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// Record Payment Collection
apiRouter.post('/payments', (req, res) => {
  try {
    const { customerId, invoiceId, amount, paymentMethod, referenceNumber, notes, createdByName, createdById } = req.body;
    if (!customerId || !amount || parseFloat(amount) <= 0) {
      return res.status(400).json({ error: 'Customer and valid payment amount are required.' });
    }

    const payAmount = parseFloat(amount);
    const customer = db.prepare('SELECT * FROM customers WHERE id = ?').get(customerId) as any;
    if (!customer) {
      return res.status(404).json({ error: 'Customer not found.' });
    }

    const currentYear = new Date().getFullYear();
    const countRow = db.prepare("SELECT COUNT(*) as c FROM payments WHERE receiptNumber LIKE ?").get(`REC-${currentYear}-%`) as { c: number };
    const receiptNumber = `REC-${currentYear}-${String(countRow.c + 1).padStart(4, '0')}`;
    const paymentId = crypto.randomUUID();
    const now = new Date().toISOString();

    let invoiceNum: string | null = null;
    let targetInvoice: any = null;
    if (invoiceId) {
      targetInvoice = db.prepare('SELECT * FROM invoices WHERE id = ?').get(invoiceId) as any;
      if (targetInvoice) {
        invoiceNum = targetInvoice.invoiceNumber;
      }
    }

    db.exec('BEGIN TRANSACTION;');
    try {
      // 1. Insert payment record
      db.prepare(`
        INSERT INTO payments (id, receiptNumber, customerId, customerName, invoiceId, invoiceNumber, amount, paymentMethod, referenceNumber, notes, createdById, createdByName, isVoided, createdAt)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?)
      `).run(
        paymentId,
        receiptNumber,
        customerId,
        customer.name,
        invoiceId || null,
        invoiceNum,
        payAmount,
        paymentMethod || 'Cash',
        referenceNumber || '',
        notes || '',
        createdById || null,
        createdByName || 'Staff',
        now
      );

      // 2. Reduce customer's outstanding balance
      const newCustomerBalance = customer.currentBalance - payAmount;
      db.prepare('UPDATE customers SET currentBalance = ?, updatedAt = ? WHERE id = ?').run(newCustomerBalance, now, customerId);

      // 3. Add Credit entry in customer ledger
      const desc = invoiceNum ? `Payment received for ${invoiceNum} [${receiptNumber}]` : `Account Payment / Udhaar Collection [${receiptNumber}]`;
      db.prepare(`
        INSERT INTO customer_ledger (id, customerId, transactionType, referenceId, referenceNumber, description, debit, credit, runningBalance, paymentMethod, createdAt)
        VALUES (?, ?, 'PAYMENT', ?, ?, ?, 0, ?, ?, ?, ?)
      `).run(crypto.randomUUID(), customerId, paymentId, receiptNumber, desc, payAmount, newCustomerBalance, paymentMethod || 'Cash', now);

      // 4. If linked to an invoice, update invoice paid amount and payment status
      if (targetInvoice) {
        const newPaid = targetInvoice.paidAmount + payAmount;
        const newBal = Math.max(0, targetInvoice.grandTotal - newPaid);
        let newStatus = targetInvoice.paymentStatus;
        if (newPaid >= targetInvoice.grandTotal) {
          newStatus = 'Paid';
        } else if (newPaid > 0) {
          newStatus = 'Partially Paid';
        }

        db.prepare('UPDATE invoices SET paidAmount = ?, balanceAmount = ?, paymentStatus = ?, updatedAt = ? WHERE id = ?').run(
          newPaid,
          newBal,
          newStatus,
          now,
          invoiceId
        );
      }

      db.exec('COMMIT;');

      logAudit(createdById, createdByName || 'Staff', 'RECORD_PAYMENT', 'PAYMENTS', paymentId, `Collected Rs ${payAmount} from ${customer.name} (${receiptNumber})`);

      res.status(201).json({
        success: true,
        paymentId,
        receiptNumber,
        amount: payAmount,
        newCustomerBalance,
      });
    } catch (e: any) {
      db.exec('ROLLBACK;');
      throw e;
    }
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// Void / Reverse Payment (Admin only, with audit trail)
apiRouter.post('/payments/:id/void', (req, res) => {
  try {
    const { id } = req.params;
    const { reason, userRole, voidedByName, voidedById } = req.body;

    if (!reason || reason.trim().length === 0) {
      return res.status(400).json({ error: 'Void reason is required.' });
    }
    if (userRole !== 'admin') {
      return res.status(403).json({ error: 'Only administrators can void saved payments.' });
    }

    const payment = db.prepare('SELECT * FROM payments WHERE id = ?').get(id) as any;
    if (!payment) {
      return res.status(404).json({ error: 'Payment not found.' });
    }
    if (payment.isVoided) {
      return res.status(400).json({ error: 'Payment has already been voided.' });
    }

    const now = new Date().toISOString();
    db.exec('BEGIN TRANSACTION;');
    try {
      db.prepare('UPDATE payments SET isVoided = 1, voidReason = ?, voidedAt = ?, voidedByName = ? WHERE id = ?').run(
        reason.trim(),
        now,
        voidedByName || 'Admin',
        id
      );

      // Restore customer balance
      const cust = db.prepare('SELECT currentBalance FROM customers WHERE id = ?').get(payment.customerId) as any;
      if (cust) {
        const newBal = cust.currentBalance + payment.amount;
        db.prepare('UPDATE customers SET currentBalance = ?, updatedAt = ? WHERE id = ?').run(newBal, now, payment.customerId);

        // Record reversal in ledger
        db.prepare(`
          INSERT INTO customer_ledger (id, customerId, transactionType, referenceId, referenceNumber, description, debit, credit, runningBalance, paymentMethod, createdAt)
          VALUES (?, ?, 'ADJUSTMENT', ?, ?, ?, ?, 0, ?, 'Adjustment', ?)
        `).run(
          crypto.randomUUID(),
          payment.customerId,
          payment.id,
          payment.receiptNumber,
          `Voided Payment ${payment.receiptNumber}: ${reason.trim()}`,
          payment.amount,
          newBal,
          now
        );
      }

      // If tied to an invoice, restore invoice balance
      if (payment.invoiceId) {
        const inv = db.prepare('SELECT * FROM invoices WHERE id = ?').get(payment.invoiceId) as any;
        if (inv) {
          const newPaid = Math.max(0, inv.paidAmount - payment.amount);
          const newBal = inv.grandTotal - newPaid;
          let newStatus = 'Unpaid';
          if (newPaid >= inv.grandTotal) {
            newStatus = 'Paid';
          } else if (newPaid > 0) {
            newStatus = 'Partially Paid';
          }
          db.prepare('UPDATE invoices SET paidAmount = ?, balanceAmount = ?, paymentStatus = ?, updatedAt = ? WHERE id = ?').run(
            newPaid,
            newBal,
            newStatus,
            now,
            inv.id
          );
        }
      }

      db.exec('COMMIT;');

      logAudit(voidedById, voidedByName || 'Admin', 'VOID_PAYMENT', 'PAYMENTS', id, `Voided payment ${payment.receiptNumber} of Rs ${payment.amount}: ${reason.trim()}`);

      res.json({ success: true, message: `Payment ${payment.receiptNumber} successfully voided.` });
    } catch (e: any) {
      db.exec('ROLLBACK;');
      throw e;
    }
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// -------------------------------------------------------------
// 7. SUPPLIERS & PURCHASES
// -------------------------------------------------------------

apiRouter.get('/suppliers', (req, res) => {
  try {
    const suppliers = db.prepare('SELECT * FROM suppliers WHERE isActive = 1 ORDER BY name ASC').all();
    res.json(suppliers);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

apiRouter.post('/suppliers', (req, res) => {
  try {
    const { name, company, phone, email, address, openingBalance, notes, createdByName, createdById } = req.body;
    if (!name || !phone) {
      return res.status(400).json({ error: 'Supplier name and phone are required.' });
    }

    const id = crypto.randomUUID();
    const now = new Date().toISOString();
    const openBal = parseFloat(openingBalance) || 0;

    db.prepare(`
      INSERT INTO suppliers (id, name, company, phone, email, address, openingBalance, currentBalance, notes, isActive, createdAt, updatedAt)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?)
    `).run(id, name.trim(), company || '', phone.trim(), email || '', address || '', openBal, openBal, notes || '', now, now);

    logAudit(createdById, createdByName || 'User', 'CREATE_SUPPLIER', 'SUPPLIERS', id, `Added supplier ${name}`);

    res.status(201).json({ id, name, phone });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

apiRouter.get('/purchases', (req, res) => {
  try {
    const purchases = db.prepare('SELECT * FROM purchases ORDER BY createdAt DESC LIMIT 100').all();
    res.json(purchases);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

apiRouter.post('/purchases', (req, res) => {
  try {
    const { supplierId, supplierName, items, totalAmount, paidAmount, paymentMethod, notes, createdByName, createdById } = req.body;
    if (!supplierId || !items || !Array.isArray(items) || items.length === 0) {
      return res.status(400).json({ error: 'Supplier and purchase items are required.' });
    }

    const currentYear = new Date().getFullYear();
    const countRow = db.prepare("SELECT COUNT(*) as c FROM purchases WHERE purchaseNumber LIKE ?").get(`PUR-${currentYear}-%`) as { c: number };
    const purchaseNumber = `PUR-${currentYear}-${String(countRow.c + 1).padStart(4, '0')}`;
    const purchaseId = crypto.randomUUID();
    const now = new Date().toISOString();

    const total = parseFloat(totalAmount) || 0;
    const paid = parseFloat(paidAmount) || 0;
    const balance = Math.max(0, total - paid);

    let paymentStatus = 'Unpaid';
    if (paid >= total) {
      paymentStatus = 'Paid';
    } else if (paid > 0) {
      paymentStatus = 'Partially Paid';
    }

    db.exec('BEGIN TRANSACTION;');
    try {
      db.prepare(`
        INSERT INTO purchases (id, purchaseNumber, supplierId, supplierName, totalAmount, paidAmount, balanceAmount, paymentStatus, paymentMethod, notes, createdById, createdByName, createdAt)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        purchaseId,
        purchaseNumber,
        supplierId,
        supplierName,
        total,
        paid,
        balance,
        paymentStatus,
        paymentMethod || 'Cash',
        notes || '',
        createdById || null,
        createdByName || 'Staff',
        now
      );

      // Increase inventory stock & record items
      for (const item of items) {
        const prod = db.prepare('SELECT stockQuantity FROM products WHERE id = ?').get(item.productId) as any;
        const currentStock = prod ? prod.stockQuantity : 0;
        const itemQty = parseFloat(item.quantity) || 1;
        const itemCost = parseFloat(item.unitCost) || 0;

        db.prepare(`
          INSERT INTO purchase_items (id, purchaseId, productId, productName, unit, quantity, unitCost, totalAmount)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        `).run(
          crypto.randomUUID(),
          purchaseId,
          item.productId,
          item.productName,
          item.unit || 'Piece',
          itemQty,
          itemCost,
          itemQty * itemCost
        );

        // Increase stock
        db.prepare('UPDATE products SET stockQuantity = stockQuantity + ?, costPrice = ?, updatedAt = ? WHERE id = ?').run(
          itemQty,
          itemCost > 0 ? itemCost : (prod ? prod.costPrice : 0),
          now,
          item.productId
        );

        // Record stock movement
        db.prepare(`
          INSERT INTO stock_movements (id, productId, movementType, quantity, previousStock, newStock, referenceId, reason, createdByName, createdAt)
          VALUES (?, ?, 'purchase', ?, ?, ?, ?, ?, ?, ?)
        `).run(
          crypto.randomUUID(),
          item.productId,
          itemQty,
          currentStock,
          currentStock + itemQty,
          purchaseNumber,
          `Purchase ${purchaseNumber}`,
          createdByName || 'Staff',
          now
        );
      }

      // Update supplier balance if balance > 0
      if (balance > 0) {
        db.prepare('UPDATE suppliers SET currentBalance = currentBalance + ?, updatedAt = ? WHERE id = ?').run(balance, now, supplierId);
      }

      db.exec('COMMIT;');

      logAudit(createdById, createdByName || 'Staff', 'RECORD_PURCHASE', 'PURCHASES', purchaseId, `Created purchase ${purchaseNumber} from ${supplierName} for Rs ${total}`);

      res.status(201).json({ success: true, purchaseId, purchaseNumber });
    } catch (e: any) {
      db.exec('ROLLBACK;');
      throw e;
    }
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// -------------------------------------------------------------
// 8. EXPENSES MANAGEMENT
// -------------------------------------------------------------

apiRouter.get('/expenses', (req, res) => {
  try {
    const { category, startDate, endDate } = req.query;
    let query = 'SELECT * FROM expenses WHERE 1=1';
    const params: any[] = [];

    if (category && category !== 'All') {
      query += ' AND category = ?';
      params.push(category);
    }
    if (startDate) {
      query += ' AND date >= ?';
      params.push(startDate);
    }
    if (endDate) {
      query += ' AND date <= ?';
      params.push(endDate);
    }

    query += ' ORDER BY date DESC, createdAt DESC LIMIT 150';
    const rows = db.prepare(query).all(...params);
    res.json(rows);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

apiRouter.post('/expenses', (req, res) => {
  try {
    const { title, category, amount, paymentMethod, date, description, createdByName, createdById } = req.body;
    if (!title || !amount) {
      return res.status(400).json({ error: 'Expense title and amount are required.' });
    }

    const expId = crypto.randomUUID();
    const now = new Date().toISOString();
    const expAmount = parseFloat(amount) || 0;
    const expDate = date || now.split('T')[0];

    db.prepare(`
      INSERT INTO expenses (id, title, category, amount, paymentMethod, date, description, createdById, createdByName, createdAt)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      expId,
      title.trim(),
      category || 'Miscellaneous',
      expAmount,
      paymentMethod || 'Cash',
      expDate,
      description || '',
      createdById || null,
      createdByName || 'Staff',
      now
    );

    logAudit(createdById, createdByName || 'Staff', 'CREATE_EXPENSE', 'EXPENSES', expId, `Added expense: ${title} (Rs ${expAmount})`);

    res.status(201).json({ success: true, id: expId });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

apiRouter.delete('/expenses/:id', (req, res) => {
  try {
    const { id } = req.params;
    const { userRole, deletedByName, deletedById } = req.body;

    if (userRole === 'cashier') {
      return res.status(403).json({ error: 'Cashier staff cannot delete expenses.' });
    }

    const exp = db.prepare('SELECT * FROM expenses WHERE id = ?').get(id) as any;
    if (!exp) {
      return res.status(404).json({ error: 'Expense not found.' });
    }

    db.prepare('DELETE FROM expenses WHERE id = ?').run(id);

    logAudit(deletedById, deletedByName || 'User', 'DELETE_EXPENSE', 'EXPENSES', id, `Deleted expense: ${exp.title} (Rs ${exp.amount})`);

    res.json({ success: true });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// -------------------------------------------------------------
// 9. DASHBOARD STATS & REAL TIME FINANCIAL REPORTS
// -------------------------------------------------------------

apiRouter.get('/dashboard/stats', (req, res) => {
  try {
    const { filter = 'today', startDate: customStart, endDate: customEnd } = req.query;

    const todayStr = new Date().toISOString().split('T')[0];
    const todayStart = `${todayStr}T00:00:00.000Z`;
    const todayEnd = `${todayStr}T23:59:59.999Z`;

    // Today's Sales
    const todaySalesRow = db.prepare(`
      SELECT COALESCE(SUM(grandTotal), 0) as total, COUNT(*) as count
      FROM invoices
      WHERE isCancelled = 0 AND createdAt >= ? AND createdAt <= ?
    `).get(todayStart, todayEnd) as { total: number; count: number };

    // Monthly Sales (current month)
    const now = new Date();
    const monthStart = new Date(Date.UTC(now.getFullYear(), now.getMonth(), 1, 0, 0, 0)).toISOString();
    const monthSalesRow = db.prepare(`
      SELECT COALESCE(SUM(grandTotal), 0) as total, COUNT(*) as count
      FROM invoices
      WHERE isCancelled = 0 AND createdAt >= ?
    `).get(monthStart) as { total: number; count: number };

    // Total Amount Received (all non-voided payments)
    const totalReceivedRow = db.prepare(`
      SELECT COALESCE(SUM(amount), 0) as total FROM payments WHERE isVoided = 0
    `).get() as { total: number };

    // Outstanding Customer Balances (Udhaar) - sum of positive customer balances
    const outstandingRow = db.prepare(`
      SELECT COALESCE(SUM(currentBalance), 0) as total FROM customers WHERE currentBalance > 0 AND isActive = 1
    `).get() as { total: number };

    // Total Expenses
    const expensesRow = db.prepare('SELECT COALESCE(SUM(amount), 0) as total FROM expenses').get() as { total: number };

    // Total Customers Count
    const custCountRow = db.prepare('SELECT COUNT(*) as count FROM customers WHERE isActive = 1').get() as { count: number };

    // Total Invoices Count
    const invCountRow = db.prepare('SELECT COUNT(*) as count FROM invoices WHERE isCancelled = 0').get() as { count: number };

    // Low Stock Products Count
    const lowStockCountRow = db.prepare('SELECT COUNT(*) as count FROM products WHERE isActive = 1 AND stockQuantity <= lowStockThreshold').get() as { count: number };

    // Cost of goods sold for profit estimation
    const cogsRow = db.prepare(`
      SELECT COALESCE(SUM(ii.costPrice * ii.quantity), 0) as cogs
      FROM invoice_items ii
      JOIN invoices i ON ii.invoiceId = i.id
      WHERE i.isCancelled = 0
    `).get() as { cogs: number };

    // All-time Net Sales
    const allNetSalesRow = db.prepare('SELECT COALESCE(SUM(grandTotal), 0) as total FROM invoices WHERE isCancelled = 0').get() as { total: number };

    // Estimated Profit = Net Sales - COGS - Total Expenses
    const estimatedProfit = allNetSalesRow.total - cogsRow.cogs - expensesRow.total;

    // Recent 5 Transactions
    const recentInvoices = db.prepare(`
      SELECT id, invoiceNumber, customerName, grandTotal, paidAmount, balanceAmount, paymentStatus, createdAt
      FROM invoices
      ORDER BY createdAt DESC
      LIMIT 5
    `).all();

    // Top 5 Customers by Sales
    const topCustomers = db.prepare(`
      SELECT customerId, customerName, COUNT(*) as invoiceCount, SUM(grandTotal) as totalSpent
      FROM invoices
      WHERE isCancelled = 0 AND customerId IS NOT NULL
      GROUP BY customerId
      ORDER BY totalSpent DESC
      LIMIT 5
    `).all();

    // Low stock product list
    const lowStockItems = db.prepare(`
      SELECT id, name, sku, stockQuantity, unit, lowStockThreshold
      FROM products
      WHERE isActive = 1 AND stockQuantity <= lowStockThreshold
      ORDER BY stockQuantity ASC
      LIMIT 5
    `).all();

    res.json({
      todaySales: todaySalesRow.total,
      todayInvoicesCount: todaySalesRow.count,
      monthlySales: monthSalesRow.total,
      totalReceived: totalReceivedRow.total,
      outstandingBalance: outstandingRow.total,
      totalExpenses: expensesRow.total,
      estimatedProfit,
      totalCustomers: custCountRow.count,
      totalInvoices: invCountRow.count,
      lowStockCount: lowStockCountRow.count,
      recentInvoices,
      topCustomers,
      lowStockItems,
    });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// Comprehensive Reports
apiRouter.get('/reports/summary', (req, res) => {
  try {
    const { reportType = 'sales', startDate, endDate } = req.query;

    let start = startDate ? `${startDate}T00:00:00.000Z` : '2000-01-01T00:00:00.000Z';
    let end = endDate ? `${endDate}T23:59:59.999Z` : '2099-12-31T23:59:59.999Z';

    if (reportType === 'customer-sales') {
      const rows = db.prepare(`
        SELECT
          c.id, c.name, c.phone, c.category, c.currentBalance,
          COUNT(i.id) as invoiceCount,
          COALESCE(SUM(i.grandTotal), 0) as totalPurchased,
          COALESCE(SUM(i.paidAmount), 0) as totalPaid
        FROM customers c
        LEFT JOIN invoices i ON c.id = i.customerId AND i.isCancelled = 0 AND i.createdAt >= ? AND i.createdAt <= ?
        GROUP BY c.id
        ORDER BY totalPurchased DESC
      `).all(start, end);
      return res.json(rows);
    }

    if (reportType === 'product-sales') {
      const rows = db.prepare(`
        SELECT
          ii.productId, ii.productName, ii.sku, ii.unit,
          SUM(ii.quantity) as totalQtySold,
          SUM(ii.totalAmount) as totalRevenue,
          SUM(ii.quantity * ii.costPrice) as totalCost,
          (SUM(ii.totalAmount) - SUM(ii.quantity * ii.costPrice)) as grossProfit
        FROM invoice_items ii
        JOIN invoices i ON ii.invoiceId = i.id
        WHERE i.isCancelled = 0 AND i.createdAt >= ? AND i.createdAt <= ?
        GROUP BY ii.productId
        ORDER BY totalRevenue DESC
      `).all(start, end);
      return res.json(rows);
    }

    if (reportType === 'udhaar-aging') {
      const rows = db.prepare(`
        SELECT id, name, phone, address, category, currentBalance, updatedAt
        FROM customers
        WHERE currentBalance > 0 AND isActive = 1
        ORDER BY currentBalance DESC
      `).all();
      return res.json(rows);
    }

    if (reportType === 'inventory-valuation') {
      const rows = db.prepare(`
        SELECT id, name, sku, categoryName, costPrice, sellingPrice, stockQuantity, unit,
               (costPrice * stockQuantity) as costValuation,
               (sellingPrice * stockQuantity) as retailValuation
        FROM products
        WHERE isActive = 1
        ORDER BY name ASC
      `).all();
      return res.json(rows);
    }

    // Default: daily/period sales breakdown
    const rows = db.prepare(`
      SELECT
        substr(createdAt, 1, 10) as saleDate,
        COUNT(*) as invoiceCount,
        SUM(subtotal) as grossSales,
        SUM(discountAmount) as discounts,
        SUM(grandTotal) as netSales,
        SUM(paidAmount) as collected,
        SUM(balanceAmount) as creditExtended
      FROM invoices
      WHERE isCancelled = 0 AND createdAt >= ? AND createdAt <= ?
      GROUP BY substr(createdAt, 1, 10)
      ORDER BY saleDate DESC
    `).all(start, end);

    res.json(rows);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// -------------------------------------------------------------
// 10. BUSINESS SETTINGS & BACKUP/RESTORE
// -------------------------------------------------------------

apiRouter.get('/settings', (req, res) => {
  try {
    const settings = db.prepare("SELECT * FROM business_settings WHERE id = 'default'").get();
    res.json(settings);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

apiRouter.put('/settings', (req, res) => {
  try {
    const {
      businessName,
      tagline,
      phone,
      email,
      address,
      currencySymbol,
      taxPercentage,
      receiptFooter,
      invoicePrefix,
      lowStockDefaultThreshold,
      theme,
      logoDataUrl,
      updatedByName,
      updatedById,
    } = req.body;

    const now = new Date().toISOString();
    db.prepare(`
      UPDATE business_settings SET
        businessName = ?, tagline = ?, phone = ?, email = ?, address = ?,
        currencySymbol = ?, taxPercentage = ?, receiptFooter = ?, invoicePrefix = ?,
        lowStockDefaultThreshold = ?, theme = ?, logoDataUrl = ?, updatedAt = ?
      WHERE id = 'default'
    `).run(
      businessName || 'Freshway Water',
      tagline || '',
      phone || '',
      email || '',
      address || '',
      currencySymbol || 'Rs',
      parseFloat(taxPercentage) || 0,
      receiptFooter || '',
      invoicePrefix || 'INV',
      parseInt(lowStockDefaultThreshold, 10) || 10,
      theme || 'light',
      logoDataUrl || '',
      now
    );

    logAudit(updatedById, updatedByName || 'Admin', 'UPDATE_SETTINGS', 'SETTINGS', 'default', `Updated business settings for ${businessName}`);

    res.json({ success: true });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// Full Database Backup Export (JSON snapshot)
apiRouter.get('/backup', (req, res) => {
  try {
    const data = {
      version: '1.0.0',
      exportedAt: new Date().toISOString(),
      business_settings: db.prepare('SELECT * FROM business_settings').all(),
      users: db.prepare('SELECT id, username, email, fullName, role, isActive, createdAt, updatedAt FROM users').all(),
      customers: db.prepare('SELECT * FROM customers').all(),
      categories: db.prepare('SELECT * FROM categories').all(),
      products: db.prepare('SELECT * FROM products').all(),
      stock_movements: db.prepare('SELECT * FROM stock_movements').all(),
      invoices: db.prepare('SELECT * FROM invoices').all(),
      invoice_items: db.prepare('SELECT * FROM invoice_items').all(),
      payments: db.prepare('SELECT * FROM payments').all(),
      customer_ledger: db.prepare('SELECT * FROM customer_ledger').all(),
      suppliers: db.prepare('SELECT * FROM suppliers').all(),
      purchases: db.prepare('SELECT * FROM purchases').all(),
      purchase_items: db.prepare('SELECT * FROM purchase_items').all(),
      expenses: db.prepare('SELECT * FROM expenses').all(),
      audit_logs: db.prepare('SELECT * FROM audit_logs').all(),
    };
    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Content-Disposition', `attachment; filename="freshway_pos_backup_${new Date().toISOString().split('T')[0]}.json"`);
    res.json(data);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// Restore from validated JSON snapshot
apiRouter.post('/restore', (req, res) => {
  try {
    const { backupData, userRole, adminName, adminId } = req.body;
    if (userRole !== 'admin') {
      return res.status(403).json({ error: 'Only administrators can restore the database.' });
    }
    if (!backupData || !backupData.customers || !backupData.products) {
      return res.status(400).json({ error: 'Invalid backup format. Required collections missing.' });
    }

    db.exec('BEGIN TRANSACTION;');
    try {
      // Clear transactional tables
      db.exec('DELETE FROM invoice_items;');
      db.exec('DELETE FROM invoices;');
      db.exec('DELETE FROM payments;');
      db.exec('DELETE FROM customer_ledger;');
      db.exec('DELETE FROM stock_movements;');
      db.exec('DELETE FROM purchase_items;');
      db.exec('DELETE FROM purchases;');
      db.exec('DELETE FROM suppliers;');
      db.exec('DELETE FROM expenses;');
      db.exec('DELETE FROM products;');
      db.exec('DELETE FROM customers;');

      // Restore customers
      if (Array.isArray(backupData.customers)) {
        const stmt = db.prepare(`
          INSERT INTO customers (id, name, phone, email, address, category, openingBalance, currentBalance, notes, isActive, createdAt, updatedAt)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `);
        for (const c of backupData.customers) {
          stmt.run(c.id, c.name, c.phone, c.email || '', c.address || '', c.category || 'Retail', c.openingBalance || 0, c.currentBalance || 0, c.notes || '', c.isActive !== undefined ? c.isActive : 1, c.createdAt, c.updatedAt);
        }
      }

      // Restore products
      if (Array.isArray(backupData.products)) {
        const stmt = db.prepare(`
          INSERT INTO products (id, name, sku, categoryName, costPrice, sellingPrice, stockQuantity, unit, barcode, lowStockThreshold, isActive, createdAt, updatedAt)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `);
        for (const p of backupData.products) {
          stmt.run(p.id, p.name, p.sku, p.categoryName || 'General', p.costPrice || 0, p.sellingPrice || 0, p.stockQuantity || 0, p.unit || 'Bottle', p.barcode || '', p.lowStockThreshold || 10, p.isActive !== undefined ? p.isActive : 1, p.createdAt, p.updatedAt);
        }
      }

      // Restore invoices
      if (Array.isArray(backupData.invoices)) {
        const stmt = db.prepare(`
          INSERT INTO invoices (id, invoiceNumber, customerId, customerName, customerPhone, customerAddress, isWalkIn, subtotal, discountType, discountValue, discountAmount, taxAmount, grandTotal, paidAmount, balanceAmount, paymentMethod, paymentStatus, notes, createdById, createdByName, isCancelled, cancelReason, cancelledAt, cancelledByName, createdAt, updatedAt)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `);
        for (const i of backupData.invoices) {
          stmt.run(i.id, i.invoiceNumber, i.customerId || null, i.customerName, i.customerPhone || '', i.customerAddress || '', i.isWalkIn ? 1 : 0, i.subtotal, i.discountType || 'fixed', i.discountValue || 0, i.discountAmount || 0, i.taxAmount || 0, i.grandTotal, i.paidAmount || 0, i.balanceAmount || 0, i.paymentMethod, i.paymentStatus, i.notes || '', i.createdById || null, i.createdByName || 'Staff', i.isCancelled ? 1 : 0, i.cancelReason || '', i.cancelledAt || '', i.cancelledByName || '', i.createdAt, i.updatedAt);
        }
      }

      // Restore invoice_items
      if (Array.isArray(backupData.invoice_items)) {
        const stmt = db.prepare(`
          INSERT INTO invoice_items (id, invoiceId, productId, productName, sku, unit, unitPrice, costPrice, quantity, discountAmount, totalAmount)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `);
        for (const it of backupData.invoice_items) {
          stmt.run(it.id, it.invoiceId, it.productId, it.productName, it.sku || '', it.unit || 'Bottle', it.unitPrice, it.costPrice || 0, it.quantity, it.discountAmount || 0, it.totalAmount);
        }
      }

      // Restore payments
      if (Array.isArray(backupData.payments)) {
        const stmt = db.prepare(`
          INSERT INTO payments (id, receiptNumber, customerId, customerName, invoiceId, invoiceNumber, amount, paymentMethod, referenceNumber, notes, createdById, createdByName, isVoided, voidReason, voidedAt, voidedByName, createdAt)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `);
        for (const p of backupData.payments) {
          stmt.run(p.id, p.receiptNumber, p.customerId, p.customerName, p.invoiceId || null, p.invoiceNumber || '', p.amount, p.paymentMethod, p.referenceNumber || '', p.notes || '', p.createdById || null, p.createdByName || 'Staff', p.isVoided ? 1 : 0, p.voidReason || '', p.voidedAt || '', p.voidedByName || '', p.createdAt);
        }
      }

      // Restore customer_ledger
      if (Array.isArray(backupData.customer_ledger)) {
        const stmt = db.prepare(`
          INSERT INTO customer_ledger (id, customerId, transactionType, referenceId, referenceNumber, description, debit, credit, runningBalance, paymentMethod, createdAt)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `);
        for (const l of backupData.customer_ledger) {
          stmt.run(l.id, l.customerId, l.transactionType, l.referenceId || null, l.referenceNumber || '', l.description, l.debit || 0, l.credit || 0, l.runningBalance || 0, l.paymentMethod || '', l.createdAt);
        }
      }

      // Restore suppliers
      if (Array.isArray(backupData.suppliers)) {
        const stmt = db.prepare(`
          INSERT INTO suppliers (id, name, company, phone, email, address, openingBalance, currentBalance, notes, isActive, createdAt, updatedAt)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `);
        for (const s of backupData.suppliers) {
          stmt.run(s.id, s.name, s.company || '', s.phone, s.email || '', s.address || '', s.openingBalance || 0, s.currentBalance || 0, s.notes || '', s.isActive !== undefined ? s.isActive : 1, s.createdAt, s.updatedAt);
        }
      }

      // Restore purchases
      if (Array.isArray(backupData.purchases)) {
        const stmt = db.prepare(`
          INSERT INTO purchases (id, purchaseNumber, supplierId, supplierName, totalAmount, paidAmount, balanceAmount, paymentStatus, paymentMethod, notes, createdById, createdByName, createdAt)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `);
        for (const pur of backupData.purchases) {
          stmt.run(pur.id, pur.purchaseNumber, pur.supplierId, pur.supplierName, pur.totalAmount, pur.paidAmount || 0, pur.balanceAmount || 0, pur.paymentStatus, pur.paymentMethod, pur.notes || '', pur.createdById || null, pur.createdByName || 'Staff', pur.createdAt);
        }
      }

      // Restore expenses
      if (Array.isArray(backupData.expenses)) {
        const stmt = db.prepare(`
          INSERT INTO expenses (id, title, category, amount, paymentMethod, date, description, createdById, createdByName, createdAt)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `);
        for (const exp of backupData.expenses) {
          stmt.run(exp.id, exp.title, exp.category, exp.amount, exp.paymentMethod, exp.date, exp.description || '', exp.createdById || null, exp.createdByName || 'Staff', exp.createdAt);
        }
      }

      db.exec('COMMIT;');

      logAudit(adminId, adminName || 'Admin', 'RESTORE_DATABASE', 'SETTINGS', 'SYSTEM', 'Restored system database from backup archive');

      res.json({ success: true, message: 'Database restored successfully from backup.' });
    } catch (e: any) {
      db.exec('ROLLBACK;');
      throw e;
    }
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// Audit Logs
apiRouter.get('/audit-logs', (req, res) => {
  try {
    const logs = db.prepare('SELECT * FROM audit_logs ORDER BY createdAt DESC LIMIT 150').all();
    res.json(logs);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

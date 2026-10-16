// Set VITE_API_BASE_URL to the deployed backend URL (for example, your Render service URL).
// Leave it empty for local development where the API is served from the same origin.
const API_BASE_URL = (import.meta as any).env?.VITE_API_BASE_URL?.trim()?.replace(/\/$/, '') || '';
const apiUrl = (path: string) => {
  // A Netlify static site cannot run the Express/SQLite API itself.
  // Fail with a clear setup message instead of a confusing 404/JSON parse error.
  const isNetlify = typeof window !== 'undefined' &&
    (window.location.hostname.endsWith('.netlify.app') || window.location.hostname === 'netlify.app');
  if (isNetlify && !API_BASE_URL) {
    throw new Error('Backend is not configured. In Netlify, set VITE_API_BASE_URL to your deployed Render service URL, then trigger a new deploy.');
  }
  return `${API_BASE_URL}${path}`;
};

import type {
  BusinessSettings,
  Customer,
  CustomerMonthlySummary,
  DashboardStats,
  Expense,
  Invoice,
  Payment,
  Product,
  Purchase,
  Supplier,
  User,
} from '../types';

async function handleResponse<T>(res: Response): Promise<T> {
  if (!res.ok) {
    let errorMsg = `Server error (${res.status})`;
    try {
      const data = await res.json();
      if (data && data.error) errorMsg = data.error;
    } catch {
      // ignore json parse error
    }
    throw new Error(errorMsg);
  }
  return res.json();
}

export const api = {
  // Auth
  async getAuthStatus(): Promise<{ needsSetup: boolean; userCount: number; settings: BusinessSettings | null }> {
    const res = await fetch(apiUrl('/api/auth/status'));
    return handleResponse(res);
  },

  async setupAdmin(data: any): Promise<{ success: boolean; user: User }> {
    const res = await fetch(apiUrl('/api/auth/setup'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    });
    return handleResponse(res);
  },

  async login(username: string, password: string): Promise<{ success: boolean; user: User }> {
    const res = await fetch(apiUrl('/api/auth/login'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password }),
    });
    return handleResponse(res);
  },

  // Users
  async getUsers(): Promise<User[]> {
    const res = await fetch(apiUrl('/api/users'));
    return handleResponse(res);
  },

  async createUser(data: any): Promise<{ success: boolean; user: User }> {
    const res = await fetch(apiUrl('/api/users'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    });
    return handleResponse(res);
  },

  async updateUser(id: string, data: any): Promise<{ success: boolean }> {
    const res = await fetch(apiUrl(`/api/users/${id}`), {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    });
    return handleResponse(res);
  },

  // Customers
  async getCustomers(params?: { search?: string; category?: string; status?: string }): Promise<Customer[]> {
    const url = new URL(apiUrl('/api/customers'), window.location.origin);
    if (params?.search) url.searchParams.set('search', params.search);
    if (params?.category) url.searchParams.set('category', params.category);
    if (params?.status) url.searchParams.set('status', params.status);
    const res = await fetch(url.toString());
    return handleResponse(res);
  },

  async getCustomer(id: string): Promise<Customer> {
    const res = await fetch(apiUrl(`/api/customers/${id}`));
    return handleResponse(res);
  },

  async createCustomer(data: any): Promise<Customer> {
    const res = await fetch(apiUrl('/api/customers'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    });
    return handleResponse(res);
  },

  async updateCustomer(id: string, data: any): Promise<{ success: boolean }> {
    const res = await fetch(apiUrl(`/api/customers/${id}`), {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    });
    return handleResponse(res);
  },

  // Customer Ledger & Monthly Summary
  async getCustomerMonthlySummary(
    id: string,
    params: { month?: number; year?: number; startDate?: string; endDate?: string }
  ): Promise<CustomerMonthlySummary> {
    const url = new URL(apiUrl(`/api/customers/${id}/monthly-summary`), window.location.origin);
    if (params.month) url.searchParams.set('month', String(params.month));
    if (params.year) url.searchParams.set('year', String(params.year));
    if (params.startDate) url.searchParams.set('startDate', params.startDate);
    if (params.endDate) url.searchParams.set('endDate', params.endDate);
    const res = await fetch(url.toString());
    return handleResponse(res);
  },

  async getCustomerLedger(id: string, params?: { startDate?: string; endDate?: string }): Promise<any> {
    const url = new URL(apiUrl(`/api/customers/${id}/ledger`), window.location.origin);
    if (params?.startDate) url.searchParams.set('startDate', params.startDate);
    if (params?.endDate) url.searchParams.set('endDate', params.endDate);
    const res = await fetch(url.toString());
    return handleResponse(res);
  },

  // Products
  async getProducts(params?: { search?: string; category?: string; lowStock?: boolean }): Promise<Product[]> {
    const url = new URL(apiUrl('/api/products'), window.location.origin);
    if (params?.search) url.searchParams.set('search', params.search);
    if (params?.category) url.searchParams.set('category', params.category);
    if (params?.lowStock) url.searchParams.set('lowStock', 'true');
    const res = await fetch(url.toString());
    return handleResponse(res);
  },

  async createProduct(data: any): Promise<{ success: boolean; id: string; sku: string }> {
    const res = await fetch(apiUrl('/api/products'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    });
    return handleResponse(res);
  },

  async updateProduct(id: string, data: any): Promise<{ success: boolean }> {
    const res = await fetch(apiUrl(`/api/products/${id}`), {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    });
    return handleResponse(res);
  },

  async adjustStock(id: string, data: { adjustmentQuantity: number; reason: string; userRole?: string; createdByName?: string; createdById?: string }): Promise<{ success: boolean; newStock: number }> {
    const res = await fetch(apiUrl(`/api/products/${id}/adjust-stock`), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    });
    return handleResponse(res);
  },

  async getProductMovements(id: string): Promise<any[]> {
    const res = await fetch(apiUrl(`/api/products/${id}/movements`));
    return handleResponse(res);
  },

  // Invoices & POS
  async getInvoices(params?: { search?: string; customerId?: string; status?: string; startDate?: string; endDate?: string; limit?: number; offset?: number }): Promise<Invoice[]> {
    const url = new URL(apiUrl('/api/invoices'), window.location.origin);
    if (params?.search) url.searchParams.set('search', params.search);
    if (params?.customerId) url.searchParams.set('customerId', params.customerId);
    if (params?.status) url.searchParams.set('status', params.status);
    if (params?.startDate) url.searchParams.set('startDate', params.startDate);
    if (params?.endDate) url.searchParams.set('endDate', params.endDate);
    if (params?.limit) url.searchParams.set('limit', String(params.limit));
    if (params?.offset) url.searchParams.set('offset', String(params.offset));
    const res = await fetch(url.toString());
    return handleResponse(res);
  },

  async getInvoice(id: string): Promise<Invoice> {
    const res = await fetch(apiUrl(`/api/invoices/${id}`));
    return handleResponse(res);
  },

  async createInvoice(data: any): Promise<{
    success: boolean;
    invoiceId: string;
    invoiceNumber: string;
    grandTotal: number;
    paidAmount: number;
    balanceAmount: number;
    paymentStatus: string;
  }> {
    const res = await fetch(apiUrl('/api/invoices'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    });
    return handleResponse(res);
  },

  async cancelInvoice(id: string, data: { reason: string; userRole?: string; cancelledByName?: string; cancelledById?: string }): Promise<{ success: boolean; message: string }> {
    const res = await fetch(apiUrl(`/api/invoices/${id}/cancel`), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    });
    return handleResponse(res);
  },

  // Payments
  async getPayments(params?: { customerId?: string; invoiceId?: string; startDate?: string; endDate?: string }): Promise<Payment[]> {
    const url = new URL(apiUrl('/api/payments'), window.location.origin);
    if (params?.customerId) url.searchParams.set('customerId', params.customerId);
    if (params?.invoiceId) url.searchParams.set('invoiceId', params.invoiceId);
    if (params?.startDate) url.searchParams.set('startDate', params.startDate);
    if (params?.endDate) url.searchParams.set('endDate', params.endDate);
    const res = await fetch(url.toString());
    return handleResponse(res);
  },

  async createPayment(data: any): Promise<{
    success: boolean;
    paymentId: string;
    receiptNumber: string;
    amount: number;
    newCustomerBalance: number;
  }> {
    const res = await fetch(apiUrl('/api/payments'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    });
    return handleResponse(res);
  },

  async voidPayment(id: string, data: { reason: string; userRole?: string; voidedByName?: string; voidedById?: string }): Promise<{ success: boolean; message: string }> {
    const res = await fetch(apiUrl(`/api/payments/${id}/void`), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    });
    return handleResponse(res);
  },

  // Suppliers & Purchases
  async getSuppliers(): Promise<Supplier[]> {
    const res = await fetch(apiUrl('/api/suppliers'));
    return handleResponse(res);
  },

  async createSupplier(data: any): Promise<{ id: string; name: string }> {
    const res = await fetch(apiUrl('/api/suppliers'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    });
    return handleResponse(res);
  },

  async getPurchases(): Promise<Purchase[]> {
    const res = await fetch(apiUrl('/api/purchases'));
    return handleResponse(res);
  },

  async createPurchase(data: any): Promise<{ success: boolean; purchaseId: string; purchaseNumber: string }> {
    const res = await fetch(apiUrl('/api/purchases'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    });
    return handleResponse(res);
  },

  // Expenses
  async getExpenses(params?: { category?: string; startDate?: string; endDate?: string }): Promise<Expense[]> {
    const url = new URL(apiUrl('/api/expenses'), window.location.origin);
    if (params?.category) url.searchParams.set('category', params.category);
    if (params?.startDate) url.searchParams.set('startDate', params.startDate);
    if (params?.endDate) url.searchParams.set('endDate', params.endDate);
    const res = await fetch(url.toString());
    return handleResponse(res);
  },

  async createExpense(data: any): Promise<{ success: boolean; id: string }> {
    const res = await fetch(apiUrl('/api/expenses'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    });
    return handleResponse(res);
  },

  async deleteExpense(id: string, data: { userRole?: string; deletedByName?: string; deletedById?: string }): Promise<{ success: boolean }> {
    const res = await fetch(apiUrl(`/api/expenses/${id}`), {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    });
    return handleResponse(res);
  },

  // Dashboard & Reports
  async getDashboardStats(params?: { filter?: string; startDate?: string; endDate?: string }): Promise<DashboardStats> {
    const url = new URL(apiUrl('/api/dashboard/stats'), window.location.origin);
    if (params?.filter) url.searchParams.set('filter', params.filter);
    if (params?.startDate) url.searchParams.set('startDate', params.startDate);
    if (params?.endDate) url.searchParams.set('endDate', params.endDate);
    const res = await fetch(url.toString());
    return handleResponse(res);
  },

  async getReportSummary(params: { reportType: string; startDate?: string; endDate?: string }): Promise<any[]> {
    const url = new URL(apiUrl('/api/reports/summary'), window.location.origin);
    url.searchParams.set('reportType', params.reportType);
    if (params.startDate) url.searchParams.set('startDate', params.startDate);
    if (params.endDate) url.searchParams.set('endDate', params.endDate);
    const res = await fetch(url.toString());
    return handleResponse(res);
  },

  // Settings & Backup
  async getSettings(): Promise<BusinessSettings> {
    const res = await fetch(apiUrl('/api/settings'));
    return handleResponse(res);
  },

  async updateSettings(data: any): Promise<{ success: boolean }> {
    const res = await fetch(apiUrl('/api/settings'), {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    });
    return handleResponse(res);
  },

  async exportBackup(): Promise<any> {
    const res = await fetch(apiUrl('/api/backup'));
    return handleResponse(res);
  },

  async restoreBackup(backupData: any, metadata: { userRole?: string; adminName?: string; adminId?: string }): Promise<{ success: boolean; message: string }> {
    const res = await fetch(apiUrl('/api/restore'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ backupData, ...metadata }),
    });
    return handleResponse(res);
  },

  async getAuditLogs(): Promise<any[]> {
    const res = await fetch(apiUrl('/api/audit-logs'));
    return handleResponse(res);
  },
};

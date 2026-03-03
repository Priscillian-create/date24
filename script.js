// Service Worker Registration
if ('serviceWorker' in navigator && !window.location.hostname.includes('stackblitz')) {
    window.addEventListener('load', () => {
        navigator.serviceWorker.register('./service-worker.js')
            .then(registration => console.log('ServiceWorker registered:', registration.scope))
            .catch(err => console.log('ServiceWorker registration failed:', err));
    });
}
window.addEventListener('error', (e) => {
    try {
        const msg = (e && e.message) || '';
        const file = (e && e.filename) || '';
        const line = (e && e.lineno) || 0;
        const col = (e && e.colno) || 0;
        const lowerMsg = (msg || '').toString().toLowerCase();
        const isAbort = lowerMsg.includes('abort') || lowerMsg.includes('err_aborted') || lowerMsg.includes('err_network_changed') || lowerMsg.includes('network_changed') || lowerMsg.includes('err_network_io_suspended') || lowerMsg.includes('network_io_suspended');
        const isLiveReload = lowerMsg.includes('livereload') || (file || '').toString().toLowerCase().includes('livereload');
        if (isAbort || isLiveReload) {
            if (e && typeof e.preventDefault === 'function') e.preventDefault();
            return;
        }
        console.error('[GlobalError]', msg, file, line, col);
        const err = e && e.error;
        if (err && err.stack) console.error(err.stack);
    } catch (_) {}
});
window.addEventListener('unhandledrejection', (e) => {
    try {
        const msg = (e && e.reason && (e.reason.message || '') || '').toString().toLowerCase();
        const isAbort = msg.includes('abort') || msg.includes('err_aborted') || msg.includes('err_network_changed') || msg.includes('network_changed') || msg.includes('err_network_io_suspended') || msg.includes('network_io_suspended') || msg.includes('livereload');
        if (isAbort) {
            e.preventDefault();
            return;
        }
    } catch (_) {}
});
if (navigator.serviceWorker) {
    navigator.serviceWorker.addEventListener('message', (e) => {
        const d = e && e.data;
        if (d && d.type === 'SW_ACTIVATED') {
            try { location.reload(); } catch (_) {}
        }
    });
}

function loadStockCheck() {
    if (stockDayBadge) {
        const d = new Date();
        const days = ['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'];
        stockDayBadge.textContent = d.getDay() === 4 ? 'Today is Thursday' : 'Today is ' + days[d.getDay()];
    }
    if (stockLastUpdated) {
        stockLastUpdated.textContent = new Date().toLocaleString();
    }
    const render = (list) => {
        if (!stockTableBody) return;
        const items = (list || []).filter(p => p && !p.deleted);
        if (items.length === 0) {
            stockTableBody.innerHTML = '<tr><td colspan="5" style="text-align: center;">No products</td></tr>';
            return;
        }
        const groups = new Map();
        for (const p of items) {
            const cat = (p.category || 'Uncategorized').toString();
            if (!groups.has(cat)) groups.set(cat, []);
            groups.get(cat).push(p);
        }
        const categories = Array.from(groups.keys()).sort((a,b) => a.localeCompare(b));
        categories.forEach(cat => {
            groups.get(cat).sort((a,b) => {
                const an = (a.name || '').toString().toLowerCase();
                const bn = (b.name || '').toString().toLowerCase();
                return an.localeCompare(bn);
            });
        });
        stockTableBody.innerHTML = '';
        const frag = document.createDocumentFragment();
        categories.forEach(cat => {
            const list = groups.get(cat);
            const totalStock = list.reduce((s,p) => s + (Number(p.stock) || 0), 0);
            const header = document.createElement('tr');
            header.style.background = '#f8f9fa';
            header.style.fontWeight = '700';
            header.innerHTML = '<td colspan="5">' + cat + ' — ' + list.length + ' items, total stock ' + totalStock + '</td>';
            frag.appendChild(header);
            list.forEach(p => {
                const tr = document.createElement('tr');
                tr.innerHTML =
                    '<td>' + (p.name || '') + '</td>' +
                    '<td>' + (p.category || '') + '</td>' +
                    '<td>' + (p.stock != null ? p.stock : '') + '</td>' +
                    '<td>' + (p.barcode || '') + '</td>' +
                    '<td>' + formatDate(p.expiryDate, true) + '</td>';
                frag.appendChild(tr);
            });
        });
        stockTableBody.appendChild(frag);
    };
    if (isOnline) {
        DataModule.fetchAllProducts().then(() => {
            dedupeProducts();
            render(products);
        }).catch(() => render(products));
    } else {
        render(products);
    }
}

// Supabase initialization
const supabaseUrl = 'https://ieriphdzlbuzqqwrymwn.supabase.co';
const supabaseKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImllcmlwaGR6bGJ1enFxd3J5bXduIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjIzMDU1MTgsImV4cCI6MjA3Nzg4MTUxOH0.bvbs6joSxf1u9U8SlaAYmjve-N6ArNYcNMtnG6-N_HU';
const supabase = window.supabase.createClient(supabaseUrl, supabaseKey);

// Global variables
let products = [], cart = [], sales = [], deletedSales = [], users = [], currentUser = null;
const PRODUCTS_PAGE_SIZE = 100;
let productsOffset = 0;
let productsHasMore = true;
let isLoadingProducts = false;
let currentPage = "pos", isOnline = navigator.onLine, syncQueue = [];
let connectionRetryCount = 0;
const MAX_RETRY_ATTEMPTS = 3, RETRY_DELAY = 5000;

// New global variables for extended features
let expenses = [], purchases = [], stockAlerts = [], profitData = [];
let expenseCategories = ['Rent', 'Utilities', 'Salaries', 'Supplies', 'Marketing', 'Maintenance', 'Other'];
let appRealtimeChannel = null;

// Settings
let settings = {
    storeName: "Pa Gerrys Mart",
    storeAddress: "Alatishe, Ibeju Lekki, Lagos State, Nigeria",
    storePhone: "+2347037850121",
    lowStockThreshold: 10,
    expiryWarningDays: 90
};
const APP_VERSION = '1.0.1';
let isReportsLoading = false;
let lastOverallTotals = { total: 0, transactions: 0, items: 0, cash: 0, pos: 0 };
let lastDailyTotals = { total: 0, transactions: 0, items: 0, cash: 0, pos: 0 };

// Local storage keys
const STORAGE_KEYS = {
    PRODUCTS: 'pagerrysmart_products',
    SALES: 'pagerrysmart_sales',
    DELETED_SALES: 'pagerrysmart_deleted_sales',
    USERS: 'pagerrysmart_users',
    SETTINGS: 'pagerrysmart_settings',
    CURRENT_USER: 'pagerrysmart_current_user',
    EXPENSES: 'pagerrysmart_expenses',
    PURCHASES: 'pagerrysmart_purchases',
    STOCK_ALERTS: 'pagerrysmart_stock_alerts',
    PROFIT_DATA: 'pagerrysmart_profit_data'
};
function runMigrations(prev) {
    const move = (from, to) => {
        try {
            const v = localStorage.getItem(from);
            if (v && !localStorage.getItem(to)) {
                localStorage.setItem(to, v);
            }
            localStorage.removeItem(from);
        } catch (_) {}
    };
    move('pgm_products', STORAGE_KEYS.PRODUCTS);
    move('pgm_sales', STORAGE_KEYS.SALES);
    move('pgm_expenses', STORAGE_KEYS.EXPENSES);
    move('pgm_purchases', STORAGE_KEYS.PURCHASES);
}
function ensureAppVersion() {
    const k = 'pagerrysmart_app_version';
    const prev = localStorage.getItem(k) || '';
    if (prev !== APP_VERSION) {
        runMigrations(prev);
        localStorage.setItem(k, APP_VERSION);
    }
}
ensureAppVersion();

// DOM elements
const loginPage = document.getElementById('login-page');
const appContainer = document.getElementById('app-container');
const loginForm = document.getElementById('login-form');
const registerForm = document.getElementById('register-form');
const navLinks = document.querySelectorAll('.nav-link');
const pageContents = document.querySelectorAll('.page-content');
const pageTitle = document.getElementById('page-title');
const currentUserEl = document.getElementById('current-user');
const userRoleEl = document.getElementById('user-role');
const logoutBtn = document.getElementById('logout-btn');
const productsGrid = document.getElementById('products-grid');
const cartItems = document.getElementById('cart-items');
const totalEl = document.getElementById('total');
const inventoryTableBody = document.getElementById('inventory-table-body');
let inventoryRenderSeq = 0;
let inventoryCategoryFilter = null;
const salesTableBody = document.getElementById('sales-table-body');
const deletedSalesTableBody = document.getElementById('deleted-sales-table-body');
const dailySalesTableBody = document.getElementById('daily-sales-table-body');
const reportProductSalesBody = document.getElementById('report-product-sales-body');
const reportCategorySalesBody = document.getElementById('report-category-sales-body');
const productModal = document.getElementById('product-modal');
const receiptModal = document.getElementById('receipt-modal');
const notification = document.getElementById('notification');
const notificationMessage = document.getElementById('notification-message');
const mobileMenuBtn = document.getElementById('mobile-menu-btn');
const sidebar = document.getElementById('sidebar');
const stockTableBody = document.getElementById('stock-table-body');
const stockLastUpdated = document.getElementById('stock-last-updated');
const stockDayBadge = document.getElementById('stock-day-badge');
const printStockBtn = document.getElementById('print-stock-btn');
let currentProductSalesRows = [];
let currentCategorySalesRows = [];

function debounce(fn, delay) {
    let timeoutId;
    return function(...args) {
        clearTimeout(timeoutId);
        timeoutId = setTimeout(() => fn.apply(this, args), delay);
    };
}

// Enhanced Stock Alert System
function checkAndGenerateAlerts() {
    const alerts = {
        expired: [],
        expiringSoon: [],
        lowStock: [],
        outOfStock: []
    };
    const today = new Date();
    products.forEach(product => {
        if (product.deleted) return;
        const expiryDate = new Date(product.expiryDate);
        const daysUntilExpiry = Math.ceil((expiryDate - today) / (1000 * 60 * 60 * 24));
        if (daysUntilExpiry < 0) {
            alerts.expired.push({
                id: product.id,
                name: product.name,
                expiryDate: product.expiryDate,
                daysExpired: Math.abs(daysUntilExpiry),
                severity: 'critical',
                message: `CRITICAL: ${product.name} expired ${Math.abs(daysUntilExpiry)} days ago`
            });
        } else if (daysUntilExpiry <= settings.expiryWarningDays) {
            alerts.expiringSoon.push({
                id: product.id,
                name: product.name,
                expiryDate: product.expiryDate,
                daysUntilExpiry: daysUntilExpiry,
                severity: daysUntilExpiry <= 7 ? 'high' : 'medium',
                message: `${daysUntilExpiry <= 7 ? 'URGENT' : 'WARNING'}: ${product.name} expires in ${daysUntilExpiry} days`
            });
        }
        if (product.stock <= 0) {
            alerts.outOfStock.push({
                id: product.id,
                name: product.name,
                currentStock: product.stock,
                severity: 'critical',
                message: `CRITICAL: ${product.name} is out of stock`
            });
        } else if (product.stock <= settings.lowStockThreshold) {
            alerts.lowStock.push({
                id: product.id,
                name: product.name,
                currentStock: product.stock,
                threshold: settings.lowStockThreshold,
                severity: product.stock <= settings.lowStockThreshold / 2 ? 'high' : 'medium',
                message: `${product.stock <= settings.lowStockThreshold / 2 ? 'URGENT' : 'WARNING'}: ${product.name} has only ${product.stock} items left (threshold: ${settings.lowStockThreshold})`
            });
        }
    });
    const allAlerts = [
        ...alerts.expired,
        ...alerts.outOfStock,
        ...alerts.expiringSoon.filter(a => a.severity === 'high'),
        ...alerts.lowStock.filter(a => a.severity === 'high'),
        ...alerts.expiringSoon.filter(a => a.severity === 'medium'),
        ...alerts.lowStock.filter(a => a.severity === 'medium')
    ];
    stockAlerts = allAlerts;
    saveToLocalStorage();
    const criticalAlerts = allAlerts.filter(alert => alert.severity === 'critical');
    if (criticalAlerts.length > 0) {
        showNotification(`${criticalAlerts.length} critical stock alerts detected! Check Analytics page for details.`, 'error');
    }
    return { all: allAlerts, byType: alerts };
}

function readArrayFromLS(key) {
    try {
        const v = localStorage.getItem(key);
        return v ? JSON.parse(v) : [];
    } catch (_) {
        return [];
    }
}

function acknowledgeAlert(productId) {
    const acknowledgedAlerts = readArrayFromLS('acknowledgedAlerts');
    if (!acknowledgedAlerts.includes(productId)) {
        acknowledgedAlerts.push(productId);
        localStorage.setItem('acknowledgedAlerts', JSON.stringify(acknowledgedAlerts));
        showNotification('Alert acknowledged', 'success');
        loadStockAlerts();
    }
}

function resolveDiscrepancy(discrepancyId, type) {
    const resolvedDiscrepancies = readArrayFromLS('resolvedDiscrepancies');
    if (!resolvedDiscrepancies.includes(discrepancyId)) {
        resolvedDiscrepancies.push(discrepancyId);
        localStorage.setItem('resolvedDiscrepancies', JSON.stringify(resolvedDiscrepancies));
        showNotification('Discrepancy resolved', 'success');
        loadDiscrepancies();
    }
}

// Connection management
function checkSupabaseConnection() {
    if (!isOnline) {
        updateConnectionStatus('offline', 'Offline');
        return;
    }
    updateConnectionStatus('checking', 'Checking connection...');
    supabase.from('products').select('count').limit(1)
        .then(() => {
            connectionRetryCount = 0;
            updateConnectionStatus('online', 'Connected');
            if (syncQueue.length > 0) processSyncQueue();
        })
        .catch(error => {
            const msg = (error && (error.message || '')).toString().toLowerCase();
            const isAbort = (error && error.name === 'AbortError') || msg.includes('abort') || msg.includes('err_aborted') || msg.includes('err_network_changed') || msg.includes('network_changed') || msg.includes('err_network_io_suspended') || msg.includes('network_io_suspended');
            if (isAbort) {
                setTimeout(checkSupabaseConnection, 2000);
                return;
            }
            updateConnectionStatus('offline', 'Connection failed');
            if (error.code === '42P17' || error.message.includes('infinite recursion')) {
                showNotification('Database policy issue detected. Some features may be limited.', 'warning');
                return;
            }
            if (connectionRetryCount < MAX_RETRY_ATTEMPTS) {
                connectionRetryCount++;
                setTimeout(checkSupabaseConnection, RETRY_DELAY);
            } else {
                showNotification('Connection to database failed. Some features may be limited.', 'warning');
            }
        });
}

function updateConnectionStatus(status, message) {
    const statusEl = document.getElementById('connection-status');
    const textEl = document.getElementById('connection-text');
    if (statusEl && textEl) {
        statusEl.className = 'connection-status ' + status;
        textEl.textContent = message;
    }
}

// PWA Install Prompt
let deferredPrompt;
const installBtn = document.getElementById('install-btn');
window.addEventListener('beforeinstallprompt', (e) => {
    deferredPrompt = e;
    installBtn.style.display = 'flex';
});
installBtn.addEventListener('click', async () => {
    if (deferredPrompt) {
        deferredPrompt.prompt();
        const { outcome } = await deferredPrompt.userChoice;
        if (outcome === 'accepted') {
            installBtn.style.display = 'none';
        }
        deferredPrompt = null;
    } else {
        showNotification('Use browser menu to install this app', 'info');
    }
});

// Online/Offline Detection
window.addEventListener('online', () => {
    isOnline = true;
    document.getElementById('offline-indicator').classList.remove('show');
    showNotification('You are back online!', 'success');
    checkSupabaseConnection();
    try {
        if (syncQueue && syncQueue.length > 0) {
            processSyncQueue();
        }
    } catch (e) {
        console.error('Error triggering sync after online:', e);
    }
    setTimeout(refreshAllData, 1000);
});
window.addEventListener('offline', () => {
    isOnline = false;
    document.getElementById('offline-indicator').classList.add('show');
});

// Authentication Module
const AuthModule = {
    async signUp(email, password, name, role = 'cashier') {
        try {
            const { data: { user } } = await supabase.auth.getUser();
            if (!user || !currentUser || currentUser.role !== 'admin') {
                showNotification("Only admins can create new users.", "error");
                return { success: false };
            }
            const adminPassword = prompt("Please confirm your admin password to continue:");
            if (!adminPassword) return { success: false };
            const { error: signInError } = await supabase.auth.signInWithPassword({
                email: currentUser.email,
                password: adminPassword
            });
            if (signInError) {
                showNotification("Incorrect admin password.", "error");
                return { success: false };
            }
            const { data, error } = await supabase.auth.admin.createUser({
                email, password, user_metadata: { name, role }
            });
            if (error) throw error;
            try {
                await supabase.from('users').insert({
                    id: data.user.id, name, email, role,
                    created_at: new Date().toISOString(),
                    last_login: new Date().toISOString(),
                    created_by: user.id
                });
            } catch (dbError) {
                console.warn('Could not save user to database:', dbError);
            }
            showNotification(`User "${name}" (${role}) created successfully!`, "success");
            return { success: true };
        } catch (error) {
            console.error("Signup error:", error);
            showNotification("Error creating user: " + error.message, "error");
            return { success: false, error: error.message };
        }
    },
    async signIn(email, password) {
        const loginSubmitBtn = document.getElementById('login-submit-btn');
        loginSubmitBtn.classList.add('loading');
        loginSubmitBtn.disabled = true;
        try {
            const { data, error } = await supabase.auth.signInWithPassword({ email, password });
            if (error) throw error;
            const fallbackUser = {
                id: data.user.id,
                name: data.user.user_metadata?.name || data.user.email?.split('@')[0] || 'User',
                email: data.user.email,
                role: data.user.user_metadata?.role || 'cashier',
                created_at: data.user.created_at,
                last_login: new Date().toISOString()
            };
            try {
                const { data: userData, error: userError } = await supabase
                    .from('users')
                    .select('*')
                    .eq('id', data.user.id)
                    .single();
                if (!userError && userData) {
                    currentUser = userData;
                    try {
                        await supabase
                            .from('users')
                            .update({ last_login: new Date().toISOString() })
                            .eq('id', data.user.id);
                    } catch (updateError) {
                        console.warn('Could not update last login:', updateError);
                    }
                } else {
                    currentUser = fallbackUser;
                    try {
                        const { data: newUser } = await supabase
                            .from('users')
                            .insert(fallbackUser)
                            .select()
                            .single();
                        if (newUser) currentUser = newUser;
                    } catch (insertError) {
                        console.warn('Could not create user in database:', insertError);
                    }
                }
            } catch (fetchError) {
                if (fetchError.message && fetchError.message.includes('infinite recursion')) {
                    showNotification('Database policy issue detected. Using limited functionality.', 'warning');
                }
                currentUser = fallbackUser;
            }
            localStorage.setItem(STORAGE_KEYS.CURRENT_USER, JSON.stringify(currentUser));
            showApp();
            showNotification('Login successful!', 'success');
            if (isOnline && syncQueue.length > 0) {
                setTimeout(() => { processSyncQueue(); }, 2000);
            }
            return { success: true };
        } catch (error) {
            console.error('Signin error:', error);
            showNotification(error.message || 'Login failed', 'error');
            return { success: false, error: error.message };
        } finally {
            loginSubmitBtn.classList.remove('loading');
            loginSubmitBtn.disabled = false;
        }
    },
    async signOut() {
        try {
            await supabase.auth.signOut();
            localStorage.removeItem(STORAGE_KEYS.CURRENT_USER);
            currentUser = null;
            showLogin();
            showNotification('Logged out successfully', 'info');
        } catch (error) {
            console.error('Signout error:', error);
            showNotification(error.message, 'error');
        }
    },
    isAdmin() {
        return currentUser && currentUser.role === 'admin';
    },
    onAuthStateChanged(callback) {
        supabase.auth.getSession().then(({ data: { session } }) => {
            if (session) {
                this.handleExistingSession(session, callback);
            } else {
                supabase.auth.onAuthStateChange(async (event, session) => {
                    if (session) {
                        this.handleExistingSession(session, callback);
                    } else {
                        currentUser = null;
                        localStorage.removeItem(STORAGE_KEYS.CURRENT_USER);
                        callback(null);
                    }
                });
                callback(null);
            }
        });
    },
    async handleExistingSession(session, callback) {
        const fallbackUser = {
            id: session.user.id,
            name: session.user.user_metadata?.name || session.user.email?.split('@')[0] || 'User',
            email: session.user.email,
            role: session.user.user_metadata?.role || 'cashier',
            created_at: session.user.created_at,
            last_login: new Date().toISOString()
        };
        try {
            const { data: userData, error } = await supabase
                .from('users')
                .select('*')
                .eq('id', session.user.id)
                .single();
            if (!error && userData) {
                currentUser = userData;
                localStorage.setItem(STORAGE_KEYS.CURRENT_USER, JSON.stringify(currentUser));
                callback(currentUser);
            } else {
                currentUser = fallbackUser;
                localStorage.setItem(STORAGE_KEYS.CURRENT_USER, JSON.stringify(currentUser));
                callback(currentUser);
                try {
                    const { data: newUser } = await supabase.from('users').insert(fallbackUser).select().single();
                    if (newUser) {
                        currentUser = newUser;
                        localStorage.setItem(STORAGE_KEYS.CURRENT_USER, JSON.stringify(currentUser));
                        callback(currentUser);
                    }
                } catch (insertError) {
                    console.warn('Could not create user in database:', insertError);
                }
            }
        } catch (fetchError) {
            if (fetchError.message && fetchError.message.includes('infinite recursion')) {
                showNotification('Database policy issue detected. Using limited functionality.', 'warning');
            }
            currentUser = fallbackUser;
            localStorage.setItem(STORAGE_KEYS.CURRENT_USER, JSON.stringify(currentUser));
            callback(currentUser);
        }
    }
};

// Data Module
const DataModule = {
    async fetchUsers() {
        try {
            if (isOnline && AuthModule.isAdmin()) {
                const { data, error } = await supabase.from('users').select('*').order('created_at', { ascending: false });
                if (error) throw error;
                users = Array.isArray(data) ? data : [];
                saveToLocalStorage();
                return users;
            }
            return users;
        } catch (error) {
            console.error('Error fetching users:', error);
            showNotification('Unable to load users list', 'warning');
            return users;
        }
    },
    async fetchProducts(offset = 0, limit = PRODUCTS_PAGE_SIZE) {
        try {
            if (isOnline) {
                let query = supabase
                    .from('products')
                    .select('id,name,category,price,stock,expirydate,barcode,deleted,created_at,updated_at')
                    .range(offset, offset + limit - 1);
                
                const { data, error } = await query;
                
                if (error) {
                    if (error.code === '42P17' || error.message.includes('infinite recursion')) {
                        showNotification('Database policy issue for products. Using local cache.', 'warning');
                    } else if (error.code === '42501' || error.message.includes('policy')) {
                        showNotification('Permission denied for products. Using local cache.', 'warning');
                    } else {
                        throw error;
                    }
                } else if (data) {
                    const normalizedProducts = data.map(product => {
                        if (product.expirydate && !product.expiryDate) {
                            product.expiryDate = product.expirydate;
                        }
                        return product;
                    });
                    const activeProducts = normalizedProducts.filter(product => !product.deleted);

                    // FIX: Use mergeProductData to respect local changes
                    if (offset === 0) {
                        products = this.mergeProductData(activeProducts);
                        dedupeProducts();
                    } else {
                        const seen = new Set(products.map(p => p.id));
                        activeProducts.forEach(sp => {
                            if (!seen.has(sp.id)) {
                                products.push(sp);
                                seen.add(sp.id);
                            }
                        });
                    }
                    productsHasMore = activeProducts.length === limit;
                    productsOffset = offset + activeProducts.length;
                    saveToLocalStorage();
                    return products;
                }
            }
            return products;
        } catch (error) {
            console.error('Error in fetchProducts:', error);
            if (error.code === '42501' || error.message.includes('policy')) {
                showNotification('Permission denied for products. Using local cache.', 'warning');
            } else if (error.code === '42P17' || error.message.includes('infinite recursion')) {
                showNotification('Database policy issue detected. Using local cache.', 'warning');
            } else {
                showNotification('Error fetching products: ' + error.message, 'error');
            }
            return products;
        }
    },
    
    async fetchAllProducts() {
        try {
            if (isOnline) {
                const acc = [];
                let offset = 0;
                const limit = PRODUCTS_PAGE_SIZE;
                while (true) {
                    const { data, error } = await supabase
                        .from('products')
                        .select('id,name,category,price,stock,expirydate,barcode,deleted,created_at,updated_at')
                        .range(offset, offset + limit - 1);
                    if (error) throw error;
                    const batch = (data || []).map(p => {
                        if (p.expirydate && !p.expiryDate) p.expiryDate = p.expirydate;
                        return p;
                    }).filter(p => !p.deleted);
                    acc.push(...batch);
                    if (!data || data.length < limit) break;
                    offset += limit;
                }
                products = DataModule.mergeProductData(acc);
                dedupeProducts();
                productsHasMore = false;
                productsOffset = products.length;
                saveToLocalStorage();
                return products;
            }
            return products;
        } catch (error) {
            console.error('Error in fetchAllProducts:', error);
            return products;
        }
    },
    
    mergeProductData(serverProducts) {
        const serverProductsMap = {};
        serverProducts.forEach(product => {
            serverProductsMap[product.id] = product;
        });
        
        const localProductsMap = {};
        products.forEach(product => {
            localProductsMap[product.id] = product;
        });
        
        const mergedProducts = [];
        
        // Merge existing products (server vs local version)
        serverProducts.forEach(serverProduct => {
            const localProduct = localProductsMap[serverProduct.id];
            
            if (localProduct) {
                const serverDate = new Date(serverProduct.updated_at || serverProduct.created_at || 0);
                const localDate = new Date(localProduct.updated_at || localProduct.created_at || 0);
                
                // If local is newer (e.g. stock just deducted), keep local
                if (localDate > serverDate) {
                    mergedProducts.push(localProduct);
                } else {
                    mergedProducts.push(serverProduct);
                }
            } else {
                mergedProducts.push(serverProduct);
            }
        });
        
        // Add local-only products (new products created offline)
        products.forEach(localProduct => {
            if (!serverProductsMap[localProduct.id]) {
                mergedProducts.push(localProduct);
            }
        });
        
        return mergedProducts;
    },
    
    async fetchSales() {
        try {
            if (isOnline) {
                const timeoutPromise = new Promise((_, reject) => 
                    setTimeout(() => reject(new Error('Request timeout')), 15000)
                );

                const allSales = [];
                let offset = 0;
                const limit = PRODUCTS_PAGE_SIZE;
                let done = false;

                while (!done) {
                    const fetchPromise = supabase
                        .from('sales')
                        .select('*')
                        .is('deleted_at', null)
                        .order('created_at', { ascending: false })
                        .range(offset, offset + limit - 1);
                    let data, error;
                    try {
                        const result = await Promise.race([fetchPromise, timeoutPromise]);
                        data = result && result.data;
                        error = result && result.error;
                    } catch (e) {
                        if (e && e.message === 'Request timeout') {
                            showNotification('Connection timeout. Using local cache.', 'warning');
                            done = true;
                            break;
                        }
                        throw e;
                    }
                    if (error) {
                        if (error.code === '42P17' || (error.message || '').includes('infinite recursion')) {
                            showNotification('Database policy issue for sales. Using local cache.', 'warning');
                        } else if (error.code === '42501' || (error.message || '').includes('policy')) {
                            showNotification('Permission denied for sales. Using local cache.', 'warning');
                        } else {
                            throw error;
                        }
                        done = true;
                    } else if (data && Array.isArray(data)) {
                        allSales.push(...data);
                        if (data.length < limit) {
                            done = true;
                        } else {
                            offset += limit;
                        }
                    } else {
                        done = true;
                    }
                }

                if (allSales.length) {
                    const validatedSales = allSales
                        .filter(s => !s.deleted && !s.deleted_at && !s.deletedAt)
                        .map(sale => {
                        if (!sale.receiptNumber && sale.receiptnumber) {
                            sale.receiptNumber = sale.receiptnumber;
                        } else if (!sale.receiptNumber && !sale.receiptnumber) {
                            sale.receiptNumber = `UNKNOWN_${Date.now()}`;
                        }
                        if (!sale.items) sale.items = [];
                        if (typeof sale.total !== 'number') {
                            sale.total = parseFloat(sale.total) || 0;
                        }
                        if (!sale.created_at) {
                            sale.created_at = new Date().toISOString();
                        }
                        return sale;
                    });
                    const localDeletedReceipts = new Set([
                        ...deletedSales.map(s => s && (s.receiptNumber || s.receiptnumber)),
                        ...sales.filter(s => s && (s.deleted || s.deleted_at || s.deletedAt)).map(s => s.receiptNumber)
                    ].filter(Boolean));
                    const serverActive = validatedSales.filter(s => !localDeletedReceipts.has(s.receiptNumber));
                    const serverMap = new Map(serverActive.map(s => [s.receiptNumber, s]));
                    const mergedSales = [];
                    sales.forEach(ls => {
                        if (!ls) return;
                        const rn = ls.receiptNumber;
                        if (ls.deleted || ls.deleted_at || ls.deletedAt) return;
                        const srv = serverMap.get(rn);
                        if (srv) {
                            if (!srv.paymentmethod && ls.paymentMethod) srv.paymentmethod = ls.paymentMethod;
                            if (!srv.paymentMethod && ls.paymentMethod) srv.paymentMethod = ls.paymentMethod;
                            if (!Array.isArray(srv.items) || srv.items.length === 0) srv.items = Array.isArray(ls.items) ? ls.items : [];
                            if ((typeof srv.total !== 'number' || isNaN(srv.total)) && typeof ls.total === 'number') srv.total = ls.total;
                            if (!srv.created_at && ls.created_at) srv.created_at = ls.created_at;
                        } else {
                            mergedSales.push(ls);
                        }
                    });
                    serverMap.forEach(v => mergedSales.push(v));
                    mergedSales.sort((a, b) => {
                        const dateA = a.created_at ? new Date(a.created_at) : new Date(0);
                        const dateB = b.created_at ? new Date(b.created_at) : new Date(0);
                        return dateB - dateA;
                    });
                    sales = mergedSales;
                    saveToLocalStorage();
                    return sales;
                }
            }
            return sales;
        } catch (error) {
            if (error && error.message === 'Request timeout') {
                showNotification('Connection timeout. Using local cache.', 'warning');
            } else if (error && (error.code === '42501' || (error.message || '').includes('policy'))) {
                showNotification('Permission denied for sales. Using local cache.', 'warning');
            } else if (error && (error.code === '42P17' || (error.message || '').includes('infinite recursion'))) {
                showNotification('Database policy issue detected. Using local cache.', 'warning');
            } else {
                console.error('Error in fetchSales:', error);
                showNotification('Error fetching sales: ' + error.message, 'error');
            }
            return sales;
        }
    },
    
    async fetchDeletedSales() {
        try {
            if (isOnline) {
                const { data, error } = await supabase.from('deleted_sales').select('*');
                if (error || !data || data.length === 0) {
                    const { data: softDeleted, error: softError } = await supabase
                        .from('sales')
                        .select('*')
                        .not('deleted_at', 'is', null);
                    if (!softError && softDeleted) {
                        deletedSales = softDeleted;
                        saveToLocalStorage();
                        return deletedSales;
                    } else {
                        deletedSales = [];
                        saveToLocalStorage();
                        return deletedSales;
                    }
                } else {
                    deletedSales = data || [];
                    saveToLocalStorage();
                    return deletedSales;
                }
            }
            return deletedSales;
        } catch (error) {
            console.error('Error fetching deleted sales:', error);
            return deletedSales;
        }
    },
    
    async fetchExpenses() {
        try {
            if (isOnline) {
                const { data, error } = await supabase.from('expenses').select('*').order('date', { ascending: false });
                if (error) throw error;
                const server = Array.isArray(data) ? data : [];
                const serverKeys = new Set(server.map(e => expenseKey(e)));
                const merged = [...server];
                (Array.isArray(expenses) ? expenses : []).forEach(le => {
                    if (!serverKeys.has(expenseKey(le))) merged.push(le);
                });
                expenses = dedupeListByKey(merged, expenseKey);
                saveToLocalStorage();
                return expenses;
            }
            return expenses;
        } catch (error) {
            console.error('Error in fetchExpenses:', error);
            showNotification('Error fetching expenses: ' + error.message, 'error');
            return expenses;
        }
    },
    
    async saveExpense(expense) {
        try {
            let userId = currentUser?.id || '00000000-0000-0000-0000-000000000000';
            const expenseToSave = {
                date: expense.date,
                description: expense.description,
                category: expense.category,
                amount: expense.amount,
                receipt: expense.receipt,
                notes: expense.notes,
                created_by: userId
            };
            if (isOnline) {
                const { data, error } = await supabase.from('expenses').insert(expenseToSave).select();
                if (error) throw error;
                if (data && data.length > 0) {
                    expenses.unshift(data[0]);
                    saveToLocalStorage();
                    return { success: true, expense: data[0] };
                }
            } else {
                expenseToSave.id = 'temp_' + Date.now();
                expenses.unshift(expenseToSave);
                saveToLocalStorage();
                addToSyncQueue({ type: 'saveExpense', data: expenseToSave });
                return { success: true, expense: expenseToSave };
            }
        } catch (error) {
            console.error('Error saving expense:', error);
            showNotification('Error saving expense: ' + error.message, 'error');
            return { success: false, error };
        }
    },
    
    async fetchPurchases() {
        try {
            if (isOnline) {
                const { data, error } = await supabase.from('purchases').select('*').order('date', { ascending: false });
                if (error) throw error;
                const server = Array.isArray(data) ? data : [];
                const serverSignatures = new Set(server.map(p => purchaseSignature(p)));
                const merged = [...server];
                (Array.isArray(purchases) ? purchases : []).forEach(lp => {
                    const sig = purchaseSignature(lp);
                    if (!serverSignatures.has(sig)) merged.push(lp);
                });
                purchases = dedupeListByKey(merged, purchaseKey);
                saveToLocalStorage();
                return purchases;
            }
            return purchases;
        } catch (error) {
            console.error('Error in fetchPurchases:', error);
            showNotification('Error fetching purchases: ' + error.message, 'error');
            return purchases;
        }
    },
    
    async savePurchase(purchase) {
        try {
            let userId = currentUser?.id || '00000000-0000-0000-0000-000000000000';
            const purchaseToSave = {
                date: purchase.date,
                supplier: purchase.supplier,
                description: purchase.description,
                amount: purchase.amount,
                invoice: purchase.invoice,
                notes: purchase.notes,
                created_by: userId
            };
            if (isOnline) {
                const { data, error } = await supabase.from('purchases').insert(purchaseToSave).select();
                if (error) throw error;
                if (data && data.length > 0) {
                    purchases.unshift(data[0]);
                    saveToLocalStorage();
                    return { success: true, purchase: data[0] };
                }
            } else {
                purchaseToSave.id = 'temp_' + Date.now();
                purchases.unshift(purchaseToSave);
                saveToLocalStorage();
                addToSyncQueue({ type: 'savePurchase', data: purchaseToSave });
                return { success: true, purchase: purchaseToSave };
            }
        } catch (error) {
            console.error('Error saving purchase:', error);
            showNotification('Error saving purchase: ' + error.message, 'error');
            return { success: false, error };
        }
    },
    
    calculateProfit(startDate, endDate) {
        const filteredSales = sales.filter(sale => {
            const saleDate = new Date(sale.created_at);
            return saleDate >= new Date(startDate) && saleDate <= new Date(endDate);
        });
        const filteredExpenses = expenses.filter(expense => {
            const expenseDate = new Date(expense.date);
            return expenseDate >= new Date(startDate) && expenseDate <= new Date(endDate);
        });
        const filteredPurchases = purchases.filter(purchase => {
            const purchaseDate = new Date(purchase.date);
            return purchaseDate >= new Date(startDate) && purchaseDate <= new Date(endDate);
        });
        const totalRevenue = filteredSales.reduce((sum, sale) => sum + sale.total, 0);
        const totalExpenses = filteredExpenses.reduce((sum, expense) => sum + expense.amount, 0);
        const totalPurchases = filteredPurchases.reduce((sum, purchase) => sum + purchase.amount, 0);
        return {
            revenue: totalRevenue,
            expenses: totalExpenses,
            purchases: totalPurchases,
            profit: totalRevenue - (totalExpenses + totalPurchases),
            salesCount: filteredSales.length,
            expenseCount: filteredExpenses.length,
            purchaseCount: filteredPurchases.length
        };
    },
    
    checkStockLevels() {
        const alerts = [];
        const today = new Date();
        products.forEach(product => {
            if (product.deleted) return;
            if (product.stock <= settings.lowStockThreshold) {
                alerts.push({
                    id: product.id,
                    type: 'low_stock',
                    productId: product.id,
                    productName: product.name,
                    currentStock: product.stock,
                    threshold: settings.lowStockThreshold,
                    message: `Low stock alert: ${product.name} has only ${product.stock} items left`,
                    created_at: today.toISOString()
                });
            }
            const expiryDate = new Date(product.expiryDate);
            const daysUntilExpiry = Math.ceil((expiryDate - today) / (1000 * 60 * 60 * 24));
            if (daysUntilExpiry <= settings.expiryWarningDays) {
                alerts.push({
                    id: product.id + '_expiry',
                    type: 'expiry_warning',
                    productId: product.id,
                    productName: product.name,
                    expiryDate: product.expiryDate,
                    daysUntilExpiry: daysUntilExpiry,
                    message: `Expiry warning: ${product.name} expires in ${daysUntilExpiry} days`,
                    created_at: today.toISOString()
                });
            }
        });
        stockAlerts = alerts;
        saveToLocalStorage();
        return alerts;
    },
    
    detectDiscrepancies() {
        const discrepancies = [];
        sales.forEach(sale => {
            if (sale.total <= 0) {
                discrepancies.push({
                    id: sale.id + '_invalid_total',
                    type: 'invalid_sale_total',
                    saleId: sale.id,
                    receiptNumber: sale.receiptNumber,
                    message: `Sale with receipt #${sale.receiptNumber} has an invalid total: ${sale.total}`,
                    created_at: new Date().toISOString()
                });
            }
            if (!sale.items || sale.items.length === 0) {
                discrepancies.push({
                    id: sale.id + '_empty_items',
                    type: 'empty_sale_items',
                    saleId: sale.id,
                    receiptNumber: sale.receiptNumber,
                    message: `Sale with receipt #${sale.receiptNumber} has no items`,
                    created_at: new Date().toISOString()
                });
            }
        });
        products.forEach(product => {
            if (product.stock < 0) {
                discrepancies.push({
                    id: product.id + '_negative_stock',
                    type: 'negative_stock',
                    productId: product.id,
                    productName: product.name,
                    currentStock: product.stock,
                    message: `Product ${product.name} has negative stock: ${product.stock}`,
                    created_at: new Date().toISOString()
                });
            }
        });
        return discrepancies;
    },
    
    async saveProduct(product) {
        const productModalLoading = document.getElementById('product-modal-loading');
        const saveProductBtn = document.getElementById('save-product-btn');
        if (productModalLoading) productModalLoading.style.display = 'flex';
        if (saveProductBtn) saveProductBtn.disabled = true;
        
        try {
            if (!product.name || !product.category || !product.price || !product.stock || !product.expiryDate) {
                throw new Error('Please fill in all required fields');
            }
            if (isNaN(product.price) || product.price <= 0) throw new Error('Please enter a valid price');
            if (isNaN(product.stock) || product.stock < 0) throw new Error('Please enter a valid stock quantity');

            // FIX: Local First Approach - Save immediately
            if (!product.id) product.id = 'temp_' + Date.now();
            product.updated_at = new Date().toISOString();
            
            const key = productKeyNCP(product);
            const existIdx = products.findIndex(p => productKeyNCP(p) === key);
            if (existIdx >= 0) {
                products[existIdx] = { ...products[existIdx], ...product };
            } else {
                products.push(product);
            }
            dedupeProducts();
            saveToLocalStorage();
            
            // Sync to server
            if (isOnline) {
                const productToSave = {
                    name: product.name,
                    category: product.category,
                    price: parseFloat(product.price),
                    stock: parseInt(product.stock),
                    expirydate: product.expiryDate,
                    barcode: product.barcode || null
                };
                
                let result;
                if (product.id && !product.id.startsWith('temp_')) {
                    const { data, error } = await supabase.from('products').update(productToSave).eq('id', product.id).select();
                    if (error) throw error;
                    result = { success: true, product: (data && data[0]) || product };
                } else {
                    const { data: existing } = await supabase.from('products').select('id').eq('name', productToSave.name).eq('category', productToSave.category).eq('price', productToSave.price);
                    if (existing && existing.length > 0) {
                        product.id = existing[0].id;
                        result = { success: true, product };
                    } else {
                        const { data, error } = await supabase.from('products').insert(productToSave).select();
                        if (error) throw error;
                        if (data && data.length > 0) {
                            const idx = products.findIndex(p => p.id === product.id);
                            if(idx >= 0) products[idx].id = data[0].id;
                            saveToLocalStorage();
                            result = { success: true, product: data[0] };
                        } else {
                            result = { success: true, product };
                        }
                    }
                }
                return result;
            } else {
                addToSyncQueue({ type: 'saveProduct', data: product });
                return { success: true, product };
            }
        } catch (error) {
            console.error('Error saving product:', error);
            showNotification('Error saving product: ' + error.message, 'error');
            return { success: false, error: error.message };
        } finally {
            if (productModalLoading) productModalLoading.style.display = 'none';
            if (saveProductBtn) saveProductBtn.disabled = false;
        }
    },
    
    async deleteProduct(productId) {
        try {
            const index = products.findIndex(p => p.id === productId);
            if (index >= 0) {
                products[index].deleted = true;
                products[index].deletedAt = new Date().toISOString();
                saveToLocalStorage();
            }
            if (isOnline) {
                try {
                    let targetId = productId;
                    const local = products.find(p => p.id === productId);
                    if (String(productId).startsWith('temp_') && local) {
                        const { data: matches } = await supabase.from('products').select('id').eq('name', local.name).eq('category', local.category).eq('price', local.price);
                        if (matches && matches.length > 0) targetId = matches[0].id;
                    }
                    const { error: deleteError } = await supabase.from('products').delete().eq('id', targetId);
                    if (deleteError) {
                        const { error: updateError } = await supabase.from('products').update({ deleted: true }).eq('id', targetId);
                        if (updateError) throw updateError;
                    }
                    products = products.filter(p => p.id !== productId && p.id !== targetId);
                    saveToLocalStorage();
                    return { success: true };
                } catch (dbError) {
                    console.error('Database delete failed:', dbError);
                    showNotification('Failed to delete from database. Marked as deleted locally.', 'warning');
                    addToSyncQueue({ type: 'deleteProduct', id: productId, data: { name: local?.name, category: local?.category, price: local?.price } });
                    return { success: true };
                }
            } else {
                const p = products.find(x => x.id === productId) || {};
                addToSyncQueue({ type: 'deleteProduct', id: productId, data: { name: p.name, category: p.category, price: p.price } });
                return { success: true };
            }
        } catch (error) {
            console.error('Error deleting product:', error);
            showNotification('Error deleting product', 'error');
            return { success: false, error };
        }
    },
    
    async saveSale(sale) {
        try {
            const existingSale = sales.find(s => s.receiptNumber === sale.receiptNumber);
            if (existingSale) return { success: true, sale: existingSale };

            const localResult = this.saveSaleLocally(sale);
            if (isOnline) {
                try {
                    let validCashierId = currentUser?.id || '00000000-0000-0000-0000-000000000000';
                    if (!validCashierId.match(/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i)) {
                        validCashierId = '00000000-0000-0000-0000-000000000000';
                    }
                    const saleToSave = {
                        receiptnumber: sale.receiptNumber,
                        cashierid: validCashierId,
                        items: sale.items,
                        total: sale.total,
                        created_at: sale.created_at,
                        cashier: sale.cashier,
                        paymentmethod: sale.paymentMethod
                    };
                    const { data, error } = await supabase.from('sales').insert(saleToSave).select();
                    if (error) throw error;
                    if (data && data.length > 0) {
                        const index = sales.findIndex(s => s.receiptNumber === sale.receiptNumber);
                        if (index >= 0) {
                            sales[index].id = data[0].id;
                            sales[index].cashierId = validCashierId;
                            saveToLocalStorage();
                        }
                        return { success: true, sale: { ...sale, id: data[0].id, cashierId: validCashierId } };
                    }
                } catch (dbError) {
                    console.error('Database operation failed:', dbError);
                    showNotification('Database error: ' + dbError.message + '. Sale saved locally.', 'warning');
                    addToSyncQueue({ type: 'saveSale', data: sale });
                    return localResult;
                }
            } else {
                addToSyncQueue({ type: 'saveSale', data: sale });
                return localResult;
            }
        } catch (error) {
            console.error('Error saving sale:', error);
            showNotification('Error saving sale', 'error');
            return { success: false, error };
        }
    },
    
    saveSaleLocally(sale) {
        sale.id = 'temp_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9);
        sales.push(sale);
        saveToLocalStorage();
        return { success: true, sale };
    },
    
    async deleteSale(saleId) {
        try {
            const saleIndex = sales.findIndex(s => s.id === saleId);
            if (saleIndex >= 0) {
                const sale = sales[saleIndex];
                sale.deleted = true;
                sale.deletedAt = new Date().toISOString();
                deletedSales.push(sale);
                sales.splice(saleIndex, 1);
                saveToLocalStorage();
            }
            if (isOnline) {
                try {
                    let { data: saleData, error: fetchError } = await supabase.from('sales').select('*').eq('id', saleId).single();
                    if (fetchError || !saleData) {
                        const localSale = deletedSales.find(s => s.id === saleId) || sales.find(s => s.id === saleId);
                        const receiptNo = localSale?.receiptnumber || localSale?.receiptNumber;
                        if (receiptNo) {
                            const { data: byReceipt } = await supabase.from('sales').select('*').eq('receiptnumber', receiptNo).single();
                            if (byReceipt) saleData = byReceipt;
                        }
                        if (!saleData) throw fetchError || new Error('Sale not found');
                    }
                    if (saleData) {
                        const archivedSale = {
                            original_sale_id: saleData.id,
                            receiptnumber: saleData.receiptnumber || saleData.receiptNumber,
                            items: saleData.items,
                            total: saleData.total,
                            created_at: saleData.created_at,
                            cashier: saleData.cashier || null,
                            cashierid: saleData.cashierid || saleData.cashierId || null,
                            deleted: true,
                            deleted_at: new Date().toISOString()
                        };
                        if (isArchiveEnabled()) {
                            await supabase.from('deleted_sales').insert(archivedSale);
                            await supabase.from('sales').delete().eq('id', saleId);
                        } else {
                            await supabase.from('sales').update({ deleted_at: archivedSale.deleted_at }).eq('id', saleId);
                        }
                        return { success: true };
                    }
                } catch (dbError) {
                    console.error('Database delete failed:', dbError);
                    showNotification('Failed to delete from database. Marked as deleted locally.', 'warning');
                    addToSyncQueue({ type: 'deleteSale', id: saleId });
                    return { success: true };
                }
            } else {
                addToSyncQueue({ type: 'deleteSale', id: saleId });
                return { success: true };
            }
        } catch (error) {
            console.error('Error deleting sale:', error);
            showNotification('Error deleting sale', 'error');
            return { success: false, error };
        }
    }
};

// Sync Queue Management
function addToSyncQueue(operation) {
    if (!operation.id) operation.id = 'op_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9);
    operation.timestamp = new Date().toISOString();
    if (operation.type === 'saveSale') {
        const receiptNumber = operation.data.receiptNumber;
        const existingIndex = syncQueue.findIndex(op => op.type === 'saveSale' && op.data.receiptNumber === receiptNumber);
        if (existingIndex !== -1) syncQueue[existingIndex] = operation;
        else syncQueue.push(operation);
    } else if (operation.type === 'saveProduct') {
        const existingIndex = syncQueue.findIndex(op => op.type === 'saveProduct' && op.data.id === operation.data.id);
        if (existingIndex !== -1) syncQueue[existingIndex] = operation;
        else syncQueue.push(operation);
    } else {
        syncQueue.push(operation);
    }
    localStorage.setItem('syncQueue', JSON.stringify(syncQueue));
    if (isOnline) processSyncQueue();
}

async function processSyncQueue() {
    if (syncQueue.length === 0) return;
    const syncStatus = document.getElementById('sync-status');
    const syncStatusText = document.getElementById('sync-status-text');
    if (syncStatus) {
        syncStatus.classList.add('show', 'syncing');
        syncStatusText.textContent = `Syncing ${syncQueue.length} operations...`;
    }
    syncQueue.sort((a, b) => new Date(a.timestamp) -new Date(b.timestamp));
    for (let i = 0; i < syncQueue.length; i++) {
        const operation = syncQueue[i];
        if (operation.synced) continue;
        try {
            let success = false;
            if (operation.type === 'saveSale') success = await syncSale(operation);
            else if (operation.type === 'saveProduct') success = await syncProduct(operation);
            else if (operation.type === 'deleteProduct') success = await syncDeleteProduct(operation);
            else if (operation.type === 'deleteSale') success = await syncDeleteSale(operation);
            else if (operation.type === 'saveExpense') success = await syncExpense(operation);
            else if (operation.type === 'savePurchase') success = await syncPurchase(operation);
            if (success) {
                operation.synced = true;
                operation.syncedAt = new Date().toISOString();
            }
        } catch (error) {
            console.error(`Error syncing operation:`, operation.type, error);
        }
        await new Promise(resolve => setTimeout(resolve, 100));
    }
    localStorage.setItem('syncQueue', JSON.stringify(syncQueue));
    const originalLength = syncQueue.length;
    syncQueue = syncQueue.filter(op => !op.synced);
    if (syncQueue.length < originalLength) {
        localStorage.setItem('syncQueue', JSON.stringify(syncQueue));
    }
    if (syncStatus && syncStatusText) {
        if (syncQueue.length === 0) {
            syncStatus.classList.remove('syncing');
            syncStatus.classList.add('show');
            syncStatusText.textContent = 'All data synced';
            setTimeout(() => syncStatus.classList.remove('show'), 3000);
            await refreshAllData();
        } else {
            syncStatus.classList.remove('syncing');
            syncStatus.classList.add('error');
            syncStatusText.textContent = `${syncQueue.length} operations pending`;
            setTimeout(() => syncStatus.classList.remove('show', 'error'), 3000);
        }
    }
}

async function syncSale(operation) {
    try {
        let validCashierId = operation.data.cashierId || '00000000-0000-0000-0000-000000000000';
        if (!validCashierId.match(/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i)) {
            validCashierId = '00000000-0000-0000-0000-000000000000';
        }
        operation.data.cashierId = validCashierId;
        const { data: existingSales } = await supabase.from('sales').select('*').eq('receiptnumber', operation.data.receiptNumber);
        if (!existingSales || existingSales.length === 0) {
            const saleToSave = {
                receiptnumber: operation.data.receiptNumber,
                cashierid: validCashierId,
                items: operation.data.items,
                total: operation.data.total,
                created_at: operation.data.created_at,
                cashier: operation.data.cashier,
                paymentmethod: operation.data.paymentMethod
            };
            const { data, error } = await supabase.from('sales').insert(saleToSave).select();
            if (error) throw error;
            if (data && data.length > 0) {
                const localSaleIndex = sales.findIndex(s => s.receiptNumber === operation.data.receiptNumber);
                if (localSaleIndex !== -1) {
                    sales[localSaleIndex].id = data[0].id;
                    saveToLocalStorage();
                }
                return true;
            }
        } else {
            const localSaleIndex = sales.findIndex(s => s.receiptNumber === operation.data.receiptNumber);
            if (localSaleIndex !== -1) {
                sales[localSaleIndex].id = existingSales[0].id;
                saveToLocalStorage();
            }
            return true;
        }
        return false;
    } catch (error) {
        console.error('Error syncing sale:', error);
        return false;
    }
}

async function syncProduct(operation) {
    try {
        if (operation.data.id && !operation.data.id.startsWith('temp_')) {
            const productToSave = {
                name: operation.data.name,
                category: operation.data.category,
                price: operation.data.price,
                stock: operation.data.stock,
                expirydate: operation.data.expiryDate,
                barcode: operation.data.barcode
            };
            const { error } = await supabase.from('products').update(productToSave).eq('id', operation.data.id);
            if (error) throw error;
        } else {
            const productToSave = {
                name: operation.data.name,
                category: operation.data.category,
                price: operation.data.price,
                stock: operation.data.stock,
                expirydate: operation.data.expiryDate,
                barcode: operation.data.barcode
            };
            const { data: existing } = await supabase.from('products').select('id').eq('name', productToSave.name).eq('category', productToSave.category).eq('price', productToSave.price);
            if (existing && existing.length > 0) {
                const existId = existing[0].id;
                const localIdx = products.findIndex(p => p.id === operation.data.id);
                if (localIdx !== -1) products[localIdx].id = existId;
                dedupeProducts();
                saveToLocalStorage();
                return true;
            }
            const { data, error } = await supabase.from('products').insert(productToSave).select();
            if (error) throw error;
            if (data && data.length > 0) {
                const localProductIndex = products.findIndex(p => p.id === operation.data.id);
                if (localProductIndex !== -1) products[localProductIndex].id = data[0].id;
                dedupeProducts();
                saveToLocalStorage();
            }
        }
        return true;
    } catch (error) {
        console.error('Error syncing product:', error);
        return false;
    }
}

async function syncDeleteProduct(operation) {
    try {
        if (!operation || !operation.id) return true;
        if (String(operation.id).startsWith('temp_')) {
            let sigData = operation.data;
            if (!sigData) {
                const local = products.find(p => p.id === operation.id);
                if (local) sigData = { name: local.name, category: local.category, price: local.price };
            }
            if (sigData && sigData.name && sigData.category && sigData.price !== undefined) {
                const { data: matches } = await supabase.from('products').select('id').eq('name', sigData.name).eq('category', sigData.category).eq('price', sigData.price);
                if (matches && matches.length > 0) {
                    const serverId = matches[0].id;
                    await supabase.from('products').delete().eq('id', serverId);
                    products = products.filter(p => p.id !== operation.id && p.id !== serverId);
                    saveToLocalStorage();
                    return true;
                }
            }
            products = products.filter(p => p.id !== operation.id);
            saveToLocalStorage();
            return true;
        }
        await supabase.from('products').delete().eq('id', operation.id);
        return true;
    } catch (error) {
        console.error('Error syncing product deletion:', error);
        return false;
    }
}

async function syncDeleteSale(operation) {
    try {
        let { data: saleData } = await supabase.from('sales').select('*').eq('id', operation.id).single();
        if (!saleData) {
            const localSale = deletedSales.find(s => s.id === operation.id) || sales.find(s => s.id === operation.id);
            const receiptNo = localSale?.receiptnumber || localSale?.receiptNumber;
            if (receiptNo) {
                const { data: byReceipt } = await supabase.from('sales').select('*').eq('receiptnumber', receiptNo).single();
                if (byReceipt) saleData = byReceipt;
            }
        }
        if (saleData) {
            const archivedSale = {
                original_sale_id: saleData.id,
                receiptnumber: saleData.receiptnumber || saleData.receiptNumber,
                items: saleData.items,
                total: saleData.total,
                created_at: saleData.created_at,
                cashier: saleData.cashier || null,
                cashierid: saleData.cashierid || saleData.cashierId || null,
                deleted: true,
                deleted_at: new Date().toISOString()
            };
            if (isArchiveEnabled()) {
                await supabase.from('deleted_sales').insert(archivedSale);
                await supabase.from('sales').delete().eq('id', operation.id);
            } else {
                await supabase.from('sales').update({ deleted_at: archivedSale.deleted_at }).eq('id', operation.id);
            }
        }
        return true;
    } catch (error) {
        console.error('Error syncing sale deletion:', error);
        return false;
    }
}

async function syncExpense(operation) {
    try {
        let userId = operation.data.created_by || '00000000-0000-0000-0000-000000000000';
        const expenseData = { ...operation.data, created_by: userId };
        if (expenseData.id && expenseData.id.startsWith('temp_')) delete expenseData.id;
        const { data, error } = await supabase.from('expenses').insert(expenseData).select();
        if (error) throw error;
        if (data && data.length > 0) {
            const localExpenseIndex = expenses.findIndex(e => e.id === operation.data.id);
            if (localExpenseIndex !== -1) {
                expenses[localExpenseIndex].id = data[0].id;
                saveToLocalStorage();
            }
            return true;
        }
        return false;
    } catch (error) {
        console.error('Error syncing expense:', error);
        return false;
    }
}

async function syncPurchase(operation) {
    try {
        let userId = (currentUser && currentUser.id) ? currentUser.id : operation.data.created_by;
        if (!userId || userId === 'undefined') userId = '00000000-0000-0000-0000-000000000000';
        const purchaseData = { ...operation.data, created_by: userId };
        if (purchaseData.id && purchaseData.id.startsWith('temp_')) delete purchaseData.id;
        const { data, error } = await supabase.from('purchases').insert(purchaseData).select();
        if (error) throw error;
        if (data && data.length > 0) {
            const localPurchaseIndex = purchases.findIndex(p => p.id === operation.data.id);
            if (localPurchaseIndex !== -1) {
                purchases[localPurchaseIndex].id = data[0].id;
                saveToLocalStorage();
            }
            return true;
        }
        return false;
    } catch (error) {
        console.error('Error syncing purchase:', error);
        return false;
    }
}

function loadSyncQueue() {
    const savedQueue = localStorage.getItem('syncQueue');
    if (savedQueue) {
        try {
            syncQueue = JSON.parse(savedQueue);
            const weekAgo = new Date();
            weekAgo.setDate(weekAgo.getDate() - 7);
            syncQueue = syncQueue.filter(op => new Date(op.timestamp || 0) > weekAgo);
        } catch (e) {
            console.error('Error parsing sync queue:', e);
            syncQueue = [];
        }
    }
}

function cleanupSyncQueue() {
    syncQueue = syncQueue.filter(op => !op.synced);
    localStorage.setItem('syncQueue', JSON.stringify(syncQueue));
}

function cleanupDuplicateSales() {
    const receiptNumbers = new Set();
    const uniqueSales = [];
    sales.forEach(sale => {
        if (!receiptNumbers.has(sale.receiptNumber)) {
            receiptNumbers.add(sale.receiptNumber);
            uniqueSales.push(sale);
        }
    });
    if (sales.length !== uniqueSales.length) {
        sales = uniqueSales;
        saveToLocalStorage();
    }
}

function isArchiveEnabled() {
    return localStorage.getItem('ARCHIVE_ENABLED') === 'true';
}

function setupRealtimeListeners() {
    if (!isOnline || appRealtimeChannel) return;
    const channel = supabase.channel('app-changes');
    channel.on('postgres_changes', { event: '*', schema: 'public', table: 'products' }, () => {
        DataModule.fetchAllProducts().then(updatedProducts => {
            products = updatedProducts;
            saveToLocalStorage();
            loadProducts();
            if (currentPage === 'inventory') loadInventory();
            checkAndGenerateAlerts();
        });
    });
    channel.on('postgres_changes', { event: '*', schema: 'public', table: 'sales' }, () => {
        DataModule.fetchSales().then(updatedSales => {
            sales = updatedSales;
            saveToLocalStorage();
            loadSales();
        });
    });
    channel.subscribe();
    appRealtimeChannel = channel;
}

function loadFromLocalStorage() {
    try {
        products = [];
        sales = [];
        deletedSales = [];
        users = [];
        currentUser = null;
        expenses = [];
        purchases = [];
        stockAlerts = [];
        profitData = [];
        
        const savedProducts = localStorage.getItem(STORAGE_KEYS.PRODUCTS);
        if (savedProducts) products = JSON.parse(savedProducts);
        
        const savedSales = localStorage.getItem(STORAGE_KEYS.SALES);
        if (savedSales) sales = JSON.parse(savedSales);
        
        const savedDeletedSales = localStorage.getItem(STORAGE_KEYS.DELETED_SALES);
        if (savedDeletedSales) deletedSales = JSON.parse(savedDeletedSales);
        
        const savedUsers = localStorage.getItem(STORAGE_KEYS.USERS);
        if (savedUsers) users = JSON.parse(savedUsers);
        
        const savedSettings = localStorage.getItem(STORAGE_KEYS.SETTINGS);
        if (savedSettings) Object.assign(settings, JSON.parse(savedSettings));
        
        const savedCurrentUser = localStorage.getItem(STORAGE_KEYS.CURRENT_USER);
        if (savedCurrentUser) currentUser = JSON.parse(savedCurrentUser);
        
        const savedExpenses = localStorage.getItem(STORAGE_KEYS.EXPENSES);
        if (savedExpenses) expenses = JSON.parse(savedExpenses);
        
        const savedPurchases = localStorage.getItem(STORAGE_KEYS.PURCHASES);
        if (savedPurchases) purchases = JSON.parse(savedPurchases);
        
        const savedStockAlerts = localStorage.getItem(STORAGE_KEYS.STOCK_ALERTS);
        if (savedStockAlerts) stockAlerts = JSON.parse(savedStockAlerts);
        
        const savedProfitData = localStorage.getItem(STORAGE_KEYS.PROFIT_DATA);
        if (savedProfitData) profitData = JSON.parse(savedProfitData);
        
    } catch (e) {
        console.error('Error loading data from localStorage:', e);
    }
}

function saveToLocalStorage() {
    try {
        localStorage.setItem(STORAGE_KEYS.PRODUCTS, JSON.stringify(products));
        localStorage.setItem(STORAGE_KEYS.SALES, JSON.stringify(sales));
        localStorage.setItem(STORAGE_KEYS.DELETED_SALES, JSON.stringify(deletedSales));
        localStorage.setItem(STORAGE_KEYS.USERS, JSON.stringify(users));
        localStorage.setItem(STORAGE_KEYS.SETTINGS, JSON.stringify(settings));
        localStorage.setItem(STORAGE_KEYS.EXPENSES, JSON.stringify(expenses));
        localStorage.setItem(STORAGE_KEYS.PURCHASES, JSON.stringify(purchases));
        localStorage.setItem(STORAGE_KEYS.STOCK_ALERTS, JSON.stringify(stockAlerts));
        localStorage.setItem(STORAGE_KEYS.PROFIT_DATA, JSON.stringify(profitData));
        if (currentUser) localStorage.setItem(STORAGE_KEYS.CURRENT_USER, JSON.stringify(currentUser));
    } catch (e) {
        console.error('Error saving data to localStorage:', e);
    }
}

function validateDataStructure() {
    let isValid = true;
    if (!Array.isArray(products)) { products = []; isValid = false; }
    if (!Array.isArray(sales)) { sales = []; isValid = false; }
    if (!Array.isArray(deletedSales)) { deletedSales = []; isValid = false; }
    if (!Array.isArray(users)) { users = []; isValid = false; }
    if (!Array.isArray(expenses)) { expenses = []; isValid = false; }
    if (!Array.isArray(purchases)) { purchases = []; isValid = false; }
    if (!Array.isArray(stockAlerts)) { stockAlerts = []; isValid = false; }
    if (!Array.isArray(profitData)) { profitData = []; isValid = false; }
    if (!settings || typeof settings !== 'object') {
        settings = {
            storeName: "Pa Gerrys Mart",
            storeAddress: "Alatishe, Ibeju Lekki, Lagos State, Nigeria",
            storePhone: "+2347037850121",
            lowStockThreshold: 10,
            expiryWarningDays: 90
        };
        isValid = false;
    }
    if (!isValid) saveToLocalStorage();
    return isValid;
}

function normalizePrice(value) {
    const n = Number(value);
    return isFinite(n) ? n.toFixed(2) : '0.00';
}

function productKeyNCP(p) {
    const barcode = (p.barcode || '').toString().trim().toLowerCase();
    if (barcode) return `barcode:${barcode}`;
    const name = (p.name || '').toString().toLowerCase();
    const category = (p.category || '').toString().toLowerCase();
    const price = normalizePrice(p.price);
    const expiry = (p.expiryDate || '').toString();
    return `${name}|${category}|${price}|${expiry}`;
}

function productSignature(p) {
    return productKeyNCP(p);
}

function dedupeProducts() {
    try {
        if (!Array.isArray(products)) return;
        const result = [];
        const seenServerIds = new Set();
        const serverSigs = new Set();
        for (let i = 0; i < products.length; i++) {
            const p = products[i];
            if (!p) continue;
            const id = p.id;
            if (id && !String(id).startsWith('temp_')) {
                const sig = productSignature(p);
                if (serverSigs.has(sig) || seenServerIds.has(id)) continue;
                seenServerIds.add(id);
                serverSigs.add(sig);
                result.push(p);
            }
        }
        const tempSigs = new Set();
        for (let i = 0; i < products.length; i++) {
            const p = products[i];
            if (!p || (p.id && !String(p.id).startsWith('temp_'))) continue;
            const sig = productSignature(p);
            if (serverSigs.has(sig) || tempSigs.has(sig)) continue;
            tempSigs.add(sig);
            result.push(p);
        }
        products = result;
    } catch (e) {
        console.error('Error de-duplicating products:', e);
    }
}

function dedupeListByKey(list, keyFn) {
    const seen = new Set();
    const out = [];
    for (let i = 0; i < list.length; i++) {
        const item = list[i];
        if (!item) continue;
        const key = keyFn(item);
        if (!key || seen.has(key)) continue;
        seen.add(key);
        out.push(item);
    }
    return out;
}

function purchaseKey(p) {
    if (p && p.id && !String(p.id).startsWith('temp_')) return String(p.id);
    return `${p.date || ''}|${(p.supplier || '').toLowerCase()}|${normalizePrice(p.amount)}`;
}

function purchaseSignature(p) {
    return purchaseKey(p);
}

function expenseKey(e) {
    return `${e.date || ''}|${(e.description || '').toLowerCase()}|${(e.category || '').toLowerCase()}|${normalizePrice(e.amount)}`;
}

function validateSalesData() {
    let isValid = true;
    if (!Array.isArray(sales)) { sales = []; isValid = false; }
    sales.forEach(sale => {
        if (!sale || typeof sale !== 'object' || !sale.receiptNumber || !sale.created_at || typeof sale.total !== 'number' || !Array.isArray(sale.items)) {
            isValid = false;
        }
    });
    if (!isValid) showNotification('Sales data validation failed.', 'warning');
    return isValid;
}

// UI Functions
function showLogin() {
    loginPage.style.display = 'flex';
    appContainer.style.display = 'none';
    if (notification && loginPage && notification.parentElement !== loginPage) {
        loginPage.appendChild(notification);
    }
}

function initChangePasswordForm() {
    if (currentUser && currentUser.email) {
        const changePasswordForm = document.getElementById('change-password-form');
        if (changePasswordForm && !document.getElementById('change-password-username')) {
            const usernameField = document.createElement('input');
            usernameField.type = 'email';
            usernameField.id = 'change-password-username';
            usernameField.name = 'username';
            usernameField.value = currentUser.email;
            usernameField.style.display = 'none';
            changePasswordForm.insertBefore(usernameField, changePasswordForm.firstChild);
        }
    }
}

async function showApp() {
    loginPage.style.display = 'none';
    appContainer.style.display = 'flex';
    if (notification && notification.parentElement !== document.body) {
        document.body.appendChild(notification);
    }
    if (currentUser) {
        currentUserEl.textContent = currentUser.name;
        userRoleEl.textContent = currentUser.role;
        const usersContainer = document.getElementById('users-container');
        if (AuthModule.isAdmin()) usersContainer.style.display = 'block';
        else usersContainer.style.display = 'none';
        
        const addProductBtns = document.querySelectorAll('.add-product-btn');
        addProductBtns.forEach(btn => { btn.style.display = AuthModule.isAdmin() ? 'block' : 'none'; });
        
        if (!AuthModule.isAdmin()) {
            document.querySelectorAll('.nav-link[data-page="expenses"], .nav-link[data-page="purchases"], .nav-link[data-page="analytics"]')
                .forEach(el => el && el.parentElement && (el.parentElement.style.display = 'none'));
        }
        initChangePasswordForm();
    }
    try {
        const [productsResult, salesResult] = await Promise.allSettled([
            DataModule.fetchProducts(0, PRODUCTS_PAGE_SIZE),
            DataModule.fetchSales()
        ]);
        if (productsResult.status === 'fulfilled') products = productsResult.value;
        if (salesResult.status === 'fulfilled') sales = salesResult.value;
        else validateSalesData();
        
        await DataModule.fetchDeletedSales();
        if (expenses.length === 0) await DataModule.fetchExpenses();
        if (purchases.length === 0) await DataModule.fetchPurchases();
        
        scheduleRender(() => checkAndGenerateAlerts());
        loadProducts();
        loadSales();
        setupRealtimeListeners();
        if (currentPage === 'reports') try { generateReport(); } catch (_) {}
    } catch (error) {
        console.error('Error loading initial data:', error);
        showNotification('Error loading data. Using offline cache.', 'warning');
        loadProducts();
        loadSales();
    }
}

function showNotification(message, type = 'success') {
    notificationMessage.textContent = message;
    notification.className = `notification ${type} show`;
    const icon = notification.querySelector('i');
    icon.className = type === 'success' ? 'fas fa-check-circle' : type === 'error' ? 'fas fa-exclamation-circle' : type === 'warning' ? 'fas fa-exclamation-triangle' : 'fas fa-info-circle';
    setTimeout(() => { notification.classList.remove('show'); }, 3000);
}

function formatCurrency(amount) {
    return new Intl.NumberFormat('en-NG', { style: 'currency', currency: 'NGN', minimumFractionDigits: 2 }).format(amount);
}

function formatDate(date, short = false) {
    if (!date) return '-';
    let d;
    if (typeof date === 'string') d = new Date(date);
    else if (date instanceof Date) d = date;
    else d = new Date(date);
    if (isNaN(d.getTime())) return '-';
    if (short) return d.toLocaleDateString();
    return d.toLocaleDateString() + ' ' + d.toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'});
}

function scheduleRender(fn) {
    if (typeof window !== 'undefined' && window.requestAnimationFrame) window.requestAnimationFrame(fn);
    else setTimeout(fn, 0);
}

function generateReceiptNumber() {
    const date = new Date();
    const year = date.getFullYear().toString().substr(-2);
    const month = (date.getMonth() + 1).toString().padStart(2, '0');
    const day = date.getDate().toString().padStart(2, '0');
    const random = Math.floor(Math.random() * 1000).toString().padStart(3, '0');
    return `R${year}${month}${day}${random}`;
}

// Page Navigation
function showPage(pageName) {
    pageContents.forEach(page => { page.style.display = 'none'; });
    const selectedPage = document.getElementById(`${pageName}-page`);
    if (selectedPage) selectedPage.style.display = 'block';
    navLinks.forEach(link => {
        link.classList.remove('active');
        if (link.getAttribute('data-page') === pageName) link.classList.add('active');
    });
    const titles = {
        'pos': 'Point of Sale', 'inventory': 'Inventory Management', 'reports': 'Sales Reports',
        'stock': 'Stock Check', 'expenses': 'Expense Management', 'purchases': 'Purchase Management',
        'analytics': 'Business Analytics', 'account': 'My Account'
    };
    pageTitle.textContent = titles[pageName] || 'Pa Gerrys Mart';
    currentPage = pageName;
    
    if (pageName === 'inventory') loadInventory();
    else if (pageName === 'reports') loadReports();
    else if (pageName === 'stock') loadStockCheck();
    else if (pageName === 'account') loadAccount();
    else if (pageName === 'expenses') loadExpenses();
    else if (pageName === 'purchases') loadPurchases();
    else if (pageName === 'analytics') loadAnalytics();
}

function validateProductData(product) {
    const validatedProduct = { ...product };
    if (!validatedProduct.name) validatedProduct.name = 'Unnamed Product';
    if (!validatedProduct.category) validatedProduct.category = 'Uncategorized';
    if (!validatedProduct.price || isNaN(validatedProduct.price)) validatedProduct.price = 0;
    if (!validatedProduct.stock || isNaN(validatedProduct.stock)) validatedProduct.stock = 0;
    if (!validatedProduct.expiryDate) {
        const date = new Date();
        date.setFullYear(date.getFullYear() + 1);
        validatedProduct.expiryDate = date.toISOString().split('T')[0];
    }
    validatedProduct.price = parseFloat(validatedProduct.price);
    validatedProduct.stock = parseInt(validatedProduct.stock);
    validatedProduct.expirydate = validatedProduct.expiryDate;
    return validatedProduct;
}

// Product Functions
function loadProducts() {
    const list = products.filter(p => !p.deleted);
    if (list.length === 0) {
        productsGrid.innerHTML = `<div class="empty-state"><i class="fas fa-box-open"></i><h3>No Products Added Yet</h3><p>Click "Add Product" to start adding your inventory</p></div>`;
        return;
    }
    productsGrid.innerHTML = '';
    const chunkSize = 100;
    let index = 0;
    function renderChunk() {
        const fragment = document.createDocumentFragment();
        const today = new Date();
        for (let i = 0; i < chunkSize && index < list.length; i++, index++) {
            const product = list[index];
            const productCard = document.createElement('div');
            productCard.className = 'product-card';
            const expiryDate = new Date(product.expiryDate);
            const daysUntilExpiry = Math.ceil((expiryDate - today) / (1000 * 60 * 60 * 24));
            let expiryWarning = '';
            let productNameStyle = '';
            if (daysUntilExpiry < 0) {
                expiryWarning = `<div class="expiry-warning"><i class="fas fa-exclamation-triangle"></i> Expired</div>`;
                productNameStyle = 'style="color: red; font-weight: bold;"';
            } else if (daysUntilExpiry <= settings.expiryWarningDays) {
                expiryWarning = `<div class="expiry-warning"><i class="fas fa-clock"></i> Expires in ${daysUntilExpiry} days</div>`;
                productNameStyle = 'style="color: red; font-weight: bold;"';
            }
            let stockClass = 'stock-high';
            if (product.stock <= 0) stockClass = 'stock-low';
            else if (product.stock <= settings.lowStockThreshold) stockClass = 'stock-medium';
            productCard.innerHTML = `
                <div class="product-img"><i class="fas fa-box"></i></div>
                <h4 ${productNameStyle}>${product.name}</h4>
                <div class="price">${formatCurrency(product.price)}</div>
                <div class="stock ${stockClass}">Stock: ${product.stock}</div>
                ${expiryWarning}
            `;
            productCard.addEventListener('click', () => addToCart(product));
            fragment.appendChild(productCard);
        }
        productsGrid.appendChild(fragment);
        if (index < list.length) setTimeout(renderChunk, 0);
    }
    renderChunk();
}

async function loadInventory() {
    const inventoryLoading = document.getElementById('inventory-loading');
    if (inventoryLoading) inventoryLoading.style.display = isOnline ? 'flex' : 'none';
    try {
        if (isOnline) await DataModule.fetchAllProducts();
    } catch (e) {}
    if (inventoryLoading) inventoryLoading.style.display = 'none';
    
    dedupeProducts();
    updateInventoryTotalFromAllProducts();
    const baseList = products.filter(p => !p.deleted);
    const msPerDay = 1000 * 60 * 60 * 24;
    const todayTs = Date.now();
    
    let list;
    if (!inventoryCategoryFilter) list = baseList.slice();
    else if (inventoryCategoryFilter === 'Expired') list = baseList.filter(p => (Date.parse(p.expiryDate) - todayTs) / msPerDay < 0);
    else if (inventoryCategoryFilter === 'Expiring Soon') list = baseList.filter(p => { const d = Math.ceil((Date.parse(p.expiryDate) - todayTs) / msPerDay); return d >= 0 && d <= settings.expiryWarningDays; });
    else if (inventoryCategoryFilter === 'Low Stock') list = baseList.filter(p => p.stock > 0 && p.stock <= settings.lowStockThreshold);
    else if (inventoryCategoryFilter === 'Out of Stock') list = baseList.filter(p => p.stock <= 0);
    else list = baseList.filter(p => ((p.category || 'Uncategorized').toString() === inventoryCategoryFilter));
    
    list.sort((a, b) => (a.name || '').toString().toLowerCase().localeCompare((b.name || '').toString().toLowerCase()));
    
    if (list.length === 0) {
        inventoryTableBody.innerHTML = `<tr><td colspan="8" style="text-align: center;">No products in inventory</td></tr>`;
        const inventoryTotalValue = document.getElementById('inventory-total-value');
        if (inventoryTotalValue) inventoryTotalValue.textContent = formatCurrency(0);
        return;
    }
    
    const totalValue = list.reduce((sum, p) => sum + ((Number(p.price) || 0) * (Number(p.stock) || 0)), 0);
    const inventoryTotalItems = document.getElementById('inventory-total-items');
    if (inventoryTotalItems) inventoryTotalItems.textContent = String(list.length);
    
    const inventoryTotalValue = document.getElementById('inventory-total-value');
    if (inventoryTotalValue) inventoryTotalValue.textContent = formatCurrency(totalValue);
    
    inventoryTableBody.innerHTML = '';
    const chunkSize = 400;
    let index = 0;
    const mySeq = ++inventoryRenderSeq;
    const seenKeys = new Set();
    
    function renderChunk() {
        if (mySeq !== inventoryRenderSeq) return;
        let html = '';
        for (let i = 0; i < chunkSize && index < list.length; i++, index++) {
            const product = list[index];
            if (!product) continue;
            const key = productKeyNCP(product);
            if (seenKeys.has(key)) continue;
            seenKeys.add(key);
            
            const daysUntilExpiry = Math.ceil((Date.parse(product.expiryDate) - todayTs) / msPerDay);
            let rowClass = '', stockBadgeClass = 'stock-high', stockBadgeText = 'In Stock';
            let expiryBadgeClass = 'expiry-good', expiryBadgeText = 'Good', productNameStyle = '';
            
            if (product.stock <= 0) { stockBadgeClass = 'stock-low'; stockBadgeText = 'Out of Stock'; }
            else if (product.stock <= settings.lowStockThreshold) { stockBadgeClass = 'stock-medium'; stockBadgeText = 'Low Stock'; }
            
            if (daysUntilExpiry < 0) {
                expiryBadgeClass = 'expiry-expired'; expiryBadgeText = 'Expired'; rowClass = 'expired';
                productNameStyle = 'style="color: red; font-weight: bold;"';
            } else if (daysUntilExpiry <= settings.expiryWarningDays) {
                expiryBadgeClass = 'expiry-warning'; expiryBadgeText = 'Expiring Soon'; rowClass = 'expiring-soon';
                productNameStyle = 'style="color: red; font-weight: bold;"';
            }
            
            let actionButtons = AuthModule.isAdmin() ? 
                `<div class="action-buttons">
                    <button class="btn-edit" onclick="editProduct('${product.id}')"><i class="fas fa-edit"></i></button>
                    <button class="btn-delete" onclick="deleteProduct('${product.id}')"><i class="fas fa-trash"></i></button>
                </div>` : '<span class="no-permission">Admin only</span>';
            
            html += `<tr ${rowClass ? `class="${rowClass}"` : ''}>
                <td>${product.id}</td>
                <td ${productNameStyle}>${product.name}</td>
                <td>${product.category}</td>
                <td>${formatCurrency(product.price)}</td>
                <td>${product.stock}</td>
                <td>${formatDate(product.expiryDate)}</td>
                <td>
                    <span class="stock-badge ${stockBadgeClass}">${stockBadgeText}</span>
                    <span class="expiry-badge ${expiryBadgeClass}">${expiryBadgeText}</span>
                </td>
                <td>${actionButtons}</td>
            </tr>`;
        }
        if (html) inventoryTableBody.insertAdjacentHTML('beforeend', html);
        if (index < list.length) requestAnimationFrame(renderChunk);
    }
    requestAnimationFrame(renderChunk);
}

function filterInventoryByCategory(cat) {
    if (inventoryCategoryFilter === cat) inventoryCategoryFilter = null;
    else inventoryCategoryFilter = cat;
    loadInventory();
}

function loadSales() {
    updateSalesTables();
    if (currentPage === 'reports') generateReport();
}

function loadDeletedSales() {
    updateSalesTables();
}

function updateSalesTables() {
    const activeSales = sales.filter(s => !s.deleted && !s.deleted_at && !s.deletedAt);
    if (activeSales.length === 0) {
        salesTableBody.innerHTML = `<tr><td colspan="5" style="text-align: center;">No sales data available</td></tr>`;
    } else {
        salesTableBody.innerHTML = '';
        const sortedSales = [...activeSales].sort((a, b) => (new Date(b.created_at || 0)) - (new Date(a.created_at || 0)));
        const recentSales = sortedSales.slice(0, 10);
        const fragment = document.createDocumentFragment();
        recentSales.forEach(sale => {
            const row = document.createElement('tr');
            let actionButtons = `<button type="button" class="btn-edit" onclick="viewSale('${sale.id}')" title="View Sale"><i class="fas fa-eye"></i></button>`;
            if (AuthModule.isAdmin()) actionButtons += `<button type="button" class="btn-delete" onclick="deleteSale('${sale.id}')" title="Delete Sale"><i class="fas fa-trash"></i></button>`;
            const totalItemsSold = sale.items.reduce((sum, item) => sum + item.quantity, 0);
            row.innerHTML = `<td>${sale.receiptNumber}</td><td>${formatDate(sale.created_at)}</td><td>${totalItemsSold}</td><td>${formatCurrency(sale.total)}</td><td><div class="action-buttons">${actionButtons}</div></td>`;
            fragment.appendChild(row);
        });
        salesTableBody.appendChild(fragment);
    }
    
    if (deletedSales.length === 0) {
        deletedSalesTableBody.innerHTML = `<tr><td colspan="5" style="text-align: center;">No deleted sales</td></tr>`;
    } else {
        deletedSalesTableBody.innerHTML = '';
        const sortedDeletedSales = [...deletedSales].sort((a, b) => (new Date(b.deleted_at || b.deletedAt || 0)) - (new Date(a.deleted_at || a.deletedAt || 0)));
        const fragmentDeleted = document.createDocumentFragment();
        sortedDeletedSales.forEach(sale => {
            const row = document.createElement('tr');
            const totalItemsSold = sale.items.reduce((sum, item) => sum + item.quantity, 0);
            row.innerHTML = `<td>${sale.receiptNumber}</td><td>${formatDate(sale.created_at)}</td><td>${totalItemsSold}</td><td>${formatCurrency(sale.total)}</td><td><span class="deleted-badge">Deleted</span></td>`;
            fragmentDeleted.appendChild(row);
        });
        deletedSalesTableBody.appendChild(fragmentDeleted);
    }
}

function loadReports() {
    const reportsLoading = document.getElementById('reports-loading');
    if (reportsLoading) reportsLoading.style.display = 'flex';
    const today = new Date().toISOString().split('T')[0];
    const reportDateEl = document.getElementById('report-date');
    if (reportDateEl) reportDateEl.value = today;
    
    setTimeout(() => {
        if (reportsLoading) reportsLoading.style.display = 'none';
        if (sales.length === 0) {
            isReportsLoading = true;
            DataModule.fetchSales().then(fetchedSales => {
                sales = fetchedSales;
                isReportsLoading = false;
                generateReport();
            }).catch(() => { isReportsLoading = false; generateReport(); });
        } else {
            generateReport();
        }
    }, 0);
}

function generateReport() {
    try {
        if (isReportsLoading) return;
        const reportDateEl = document.getElementById('report-date');
        const selectedDate = reportDateEl ? reportDateEl.value : new Date().toISOString().split('T')[0];
        const selectedDateObj = new Date(selectedDate);
        if (isNaN(selectedDateObj.getTime())) { selectedDateObj = new Date(); }
        selectedDateObj.setHours(0, 0, 0, 0);
        
        const activeSales = Array.isArray(sales) ? sales.filter(s => !s.deleted && !s.deleted_at && !s.deletedAt) : [];
        const archivedSales = Array.isArray(deletedSales) ? deletedSales : [];

        const combinedMap = new Map();
        for (const s of [...activeSales, ...archivedSales]) {
            if (!s || typeof s !== 'object') continue;
            const rn = s.receiptnumber || s.receiptNumber || `NO_RN_${s.id || Math.random()}`;
            if (!combinedMap.has(rn)) combinedMap.set(rn, s);
        }
        const combinedSales = Array.from(combinedMap.values());

        let totalSales = 0, totalTransactions = 0, totalItemsSold = 0, totalCash = 0, totalPos = 0;
        
        activeSales.forEach(sale => {
            if (!sale || typeof sale !== 'object') return;
            totalSales += (typeof sale.total === 'number') ? sale.total : parseFloat(sale.total) || 0;
            totalTransactions++;
            if (Array.isArray(sale.items)) sale.items.forEach(item => totalItemsSold += Number(item.quantity) || 0);
            const pm = ((sale.paymentMethod || sale.paymentmethod || '') + '').toLowerCase();
            if (pm === 'cash') totalCash += (typeof sale.total === 'number') ? sale.total : parseFloat(sale.total) || 0;
            else if (pm === 'pos') totalPos += (typeof sale.total === 'number') ? sale.total : parseFloat(sale.total) || 0;
        });
        
        document.getElementById('report-total-sales').textContent = formatCurrency(totalSales);
        document.getElementById('report-transactions').textContent = totalTransactions;
        document.getElementById('report-items-sold').textContent = totalItemsSold;
        document.getElementById('report-cash-sales').textContent = formatCurrency(totalCash);
        document.getElementById('report-pos-sales').textContent = formatCurrency(totalPos);
        
        let dailyTotal = 0, dailyTransactions = 0, dailyItems = 0, dailyCash = 0, dailyPos = 0;
        const dailySales = [];
        
        activeSales.forEach(sale => {
            if (!sale || typeof sale !== 'object' || !sale.created_at) return;
            const saleDate = new Date(sale.created_at);
            if (isNaN(saleDate.getTime())) return;
            const sameDay = saleDate.getFullYear() === selectedDateObj.getFullYear() &&
                saleDate.getMonth() === selectedDateObj.getMonth() &&
                saleDate.getDate() === selectedDateObj.getDate();
            if (sameDay) {
                dailyTotal += sale.total || 0;
                dailyTransactions++;
                if (Array.isArray(sale.items)) sale.items.forEach(item => dailyItems += item.quantity || 0);
                const pm2 = ((sale.paymentMethod || sale.paymentmethod || '') + '').toLowerCase();
                if (pm2 === 'cash') dailyCash += sale.total || 0;
                else if (pm2 === 'pos') dailyPos += sale.total || 0;
                dailySales.push(sale);
            }
        });
        
        document.getElementById('daily-total-sales').textContent = formatCurrency(dailyTotal);
        document.getElementById('daily-transactions').textContent = dailyTransactions;
        document.getElementById('daily-items-sold').textContent = dailyItems;
        document.getElementById('daily-cash-sales').textContent = formatCurrency(dailyCash);
        document.getElementById('daily-pos-sales').textContent = formatCurrency(dailyPos);
        
        if (!dailySalesTableBody) return;
        if (dailySales.length === 0) {
            dailySalesTableBody.innerHTML = `<tr><td colspan="5" class="no-data">No sales data for selected date</td></tr>`;
        } else {
            dailySalesTableBody.innerHTML = '';
            dailySales.sort((a, b) => (new Date(b.created_at || 0)) - (new Date(a.created_at || 0)));
            let idx = 0;
            const chunkSize = 200;
            function renderDailyChunk() {
                let html = '';
                for (let i = 0; i < chunkSize && idx < dailySales.length; i++, idx++) {
                    const sale = dailySales[idx];
                    let actionButtons = `<button class="btn-edit" onclick="viewSale('${sale.id}')" title="View Sale"><i class="fas fa-eye"></i></button>`;
                    if (AuthModule.isAdmin()) actionButtons += `<button class="btn-delete" onclick="deleteSale('${sale.id}')" title="Delete Sale"><i class="fas fa-trash"></i></button>`;
                    const totalItemsSoldRow = Array.isArray(sale.items) ? sale.items.reduce((sum, item) => sum + (item.quantity || 0), 0) : 0;
                    html += `<tr>
                        <td>${sale.receiptNumber || 'N/A'}</td>
                        <td>${formatDate(sale.created_at)}</td>
                        <td>${totalItemsSoldRow}</td>
                        <td>${formatCurrency(sale.total || 0)}</td>
                        <td><div class="action-buttons">${actionButtons}</div></td>
                    </tr>`;
                }
                if (html) dailySalesTableBody.insertAdjacentHTML('beforeend', html);
                if (idx < dailySales.length) requestAnimationFrame(renderDailyChunk);
            }
            requestAnimationFrame(renderDailyChunk);
        }
        
        // Render Product and Category Sales
        const productCountMap = new Map();
        const categoryCountMap = new Map();
        const productById = new Map(Array.isArray(products) ? products.map(p => [p.id, p]) : []);
        activeSales.forEach(sale => {
            if (!sale || !Array.isArray(sale.items)) return;
            sale.items.forEach(item => {
                const qty = Number(item.quantity) || 0;
                const pid = item.id || item.productId || '';
                const pname = item.name || 'Unknown';
                const price = Number(item.price) || 0;
                const amt = price * qty;
                if (pid || pname) {
                    const existing = productCountMap.get(pid || pname);
                    if (existing) { existing.count += qty; existing.amount += amt; }
                    else productCountMap.set(pid || pname, { name: pname, count: qty, amount: amt });
                }
                let category = 'Uncategorized';
                const p = pid ? productById.get(pid) : null;
                if (p && p.category) category = p.category;
                const c = categoryCountMap.get(category);
                if (c) { c.count += qty; c.amount += amt; }
                else categoryCountMap.set(category, { count: qty, amount: amt });
            });
        });
        currentProductSalesRows = Array.from(productCountMap.values()).sort((a, b) => b.count - a.count);
        currentCategorySalesRows = Array.from(categoryCountMap.entries()).map(([category, v]) => ({ category, count: v.count, amount: v.amount })).sort((a, b) => b.count - a.count);
        renderProductSalesTable(currentProductSalesRows, '');
        renderCategorySalesTable(currentCategorySalesRows, '');
        
    } catch (error) {
        console.error('Error generating report:', error);
        showNotification('Error generating report: ' + error.message, 'error');
    }
}

function renderProductSalesTable(rows, query) {
    if (!reportProductSalesBody) return;
    const q = (query || '').toString().trim().toLowerCase();
    const list = q ? rows.filter(r => (r.name || '').toString().toLowerCase().includes(q)) : rows;
    if (!list || list.length === 0) {
        reportProductSalesBody.innerHTML = `<tr><td colspan="3" style="text-align: center;">No product sales data</td></tr>`;
        return;
    }
    reportProductSalesBody.innerHTML = '';
    const fragment = document.createDocumentFragment();
    list.forEach(r => {
        const row = document.createElement('tr');
        row.innerHTML = `<td>${r.name}</td><td>${r.count}</td><td>${formatCurrency(r.amount || 0)}</td>`;
        fragment.appendChild(row);
    });
    reportProductSalesBody.appendChild(fragment);
}

function renderCategorySalesTable(rows, query) {
    if (!reportCategorySalesBody) return;
    const q = (query || '').toString().trim().toLowerCase();
    const list = q ? rows.filter(r => (r.category || '').toString().toLowerCase().includes(q)) : rows;
    if (!list || list.length === 0) {
        reportCategorySalesBody.innerHTML = `<tr><td colspan="3" style="text-align: center;">No category sales data</td></tr>`;
        return;
    }
    reportCategorySalesBody.innerHTML = '';
    const fragment = document.createDocumentFragment();
    list.forEach(r => {
        const row = document.createElement('tr');
        row.innerHTML = `<td>${r.category}</td><td>${r.count}</td><td>${formatCurrency(r.amount || 0)}</td>`;
        fragment.appendChild(row);
    });
    reportCategorySalesBody.appendChild(fragment);
}

function loadAccount() {
    const accountLoading = document.getElementById('account-loading');
    if (accountLoading) accountLoading.style.display = 'flex';
    setTimeout(() => {
        if (accountLoading) accountLoading.style.display = 'none';
        if (currentUser) {
            document.getElementById('user-name').textContent = currentUser.name;
            document.getElementById('user-email').textContent = currentUser.email;
            document.getElementById('user-role-display').textContent = currentUser.role;
            document.getElementById('user-created').textContent = formatDate(currentUser.created_at);
            document.getElementById('user-last-login').textContent = formatDate(currentUser.last_login);
        }
        if (AuthModule.isAdmin()) {
            (async () => { await DataModule.fetchUsers(); loadUsers(); })();
        }
    }, 500);
}

function loadUsers() {
    const usersList = document.getElementById('users-list');
    if (!usersList) return;
    usersList.innerHTML = '';
    if (users.length === 0) { usersList.innerHTML = '<p>No users found</p>'; return; }
    users.forEach(user => {
        const userCard = document.createElement('div');
        userCard.className = 'user-card';
        userCard.innerHTML = `
            <div class="user-info">
                <strong>${user.name}</strong>
                <span>${user.email}</span>
                <span class="role-badge ${user.role}">${user.role}</span>
            </div>
            <div class="action-buttons">
                <select onchange="updateUserRole('${user.id}', this.value)">
                    <option value="cashier" ${user.role === 'cashier' ? 'selected' : ''}>Cashier</option>
                    <option value="admin" ${user.role === 'admin' ? 'selected' : ''}>Admin</option>
                </select>
                <button class="btn-delete" onclick="deleteUser('${user.id}')"><i class="fas fa-trash"></i></button>
            </div>
        `;
        usersList.appendChild(userCard);
    });
}

async function updateUserRole(userId, newRole) {
    try {
        if (!AuthModule.isAdmin()) { showNotification('Only admins can change roles', 'error'); return; }
        const { error } = await supabase.from('users').update({ role: newRole }).eq('id', userId);
        if (error) throw error;
        const u = users.find(u => u.id === userId);
        if (u) u.role = newRole;
        saveToLocalStorage();
        loadUsers();
        showNotification('User role updated', 'success');
    } catch (e) { showNotification('Failed to update role: ' + (e.message || ''), 'error'); }
}

async function deleteUser(userId) {
    try {
        if (!AuthModule.isAdmin()) { showNotification('Only admins can delete users', 'error'); return; }
        if (!confirm('Delete this user?')) return;
        const { error } = await supabase.from('users').delete().eq('id', userId);
        if (error) throw error;
        users = users.filter(u => u.id !== userId);
        saveToLocalStorage();
        loadUsers();
        showNotification('User removed', 'success');
    } catch (e) { showNotification('Failed to delete user: ' + (e.message || ''), 'error'); }
}

// Cart Functions
function addToCart(product) {
    if (product.stock <= 0) { showNotification('Product is out of stock', 'error'); return; }
    const existingItem = cart.find(item => item.id === product.id);
    if (existingItem) {
        if (existingItem.quantity >= product.stock) { showNotification('Not enough stock available', 'error'); return; }
        existingItem.quantity++;
    } else {
        cart.push({ id: product.id, name: product.name, price: product.price, quantity: 1 });
    }
    updateCart();
}

function updateCart() {
    if (cart.length === 0) {
        cartItems.innerHTML = '<p style="text-align: center; color: #999; padding: 20px;">No items in cart</p>';
        totalEl.textContent = formatCurrency(0);
        return;
    }
    cartItems.innerHTML = '';
    let total = 0;
    cart.forEach(item => {
        const itemTotal = item.price * item.quantity;
        total += itemTotal;
        const cartItem = document.createElement('div');
        cartItem.className = 'cart-item';
        cartItem.innerHTML = `
            <div class="cart-item-info">
                <div class="cart-item-name">${item.name}</div>
                <div class="cart-item-price">${formatCurrency(item.price)}</div>
                <div class="cart-item-qty">
                    <button onclick="updateQuantity('${item.id}', -1)">-</button>
                    <input type="number" value="${item.quantity}" min="1" readonly>
                    <button onclick="updateQuantity('${item.id}', 1)">+</button>
                </div>
            </div>
            <div class="cart-item-total">${formatCurrency(itemTotal)}</div>
        `;
        cartItems.appendChild(cartItem);
    });
    totalEl.textContent = formatCurrency(total);
}

function updateQuantity(productId, change) {
    const item = cart.find(item => item.id === productId);
    if (!item) return;
    const product = products.find(p => p.id === productId);
    if (!product) return;
    const newQuantity = item.quantity + change;
    if (newQuantity <= 0) cart = cart.filter(item => item.id !== productId);
    else if (newQuantity <= product.stock) item.quantity = newQuantity;
    else { showNotification('Not enough stock available', 'error'); return; }
    updateCart();
}

function clearCart() {
    cart = [];
    updateCart();
}

async function completeSale() {
    if (cart.length === 0) { showNotification('Cart is empty', 'error'); return; }
    const completeSaleBtn = document.getElementById('complete-sale-btn');
    completeSaleBtn.classList.add('loading');
    completeSaleBtn.disabled = true;
    try {
        let validCashierId = currentUser?.id || '00000000-0000-0000-0000-000000000000';
        if (!validCashierId.match(/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i)) validCashierId = '00000000-0000-0000-0000-000000000000';
        
        const pmEl = document.getElementById('payment-method');
        const paymentMethod = pmEl && pmEl.value ? pmEl.value : 'cash';
        const sale = {
            receiptNumber: generateReceiptNumber(),
            clientSaleId: 'client_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9),
            items: [...cart],
            total: cart.reduce((sum, item) => sum + (item.price * item.quantity), 0),
            created_at: new Date().toISOString(),
            cashier: currentUser.name,
            cashierId: validCashierId,
            paymentMethod: paymentMethod
        };
        const result = await DataModule.saveSale(sale);
        if (result.success) {
            for (const cartItem of cart) {
                let product = products.find(p => String(p.id) === String(cartItem.id));
                if (!product) product = products.find(p => (p && p.name === cartItem.name && Number(p.price) === Number(cartItem.price)));
                if (product) {
                    const newStock = Math.max(0, Number(product.stock || 0) - Number(cartItem.quantity || 0));
                    product.stock = newStock;
                    product.updated_at = new Date().toISOString(); // Set timestamp for merge
                    addToSyncQueue({
                        type: 'saveProduct',
                        data: {
                            id: product.id,
                            stock: product.stock,
                            name: product.name,
                            category: product.category,
                            price: product.price,
                            expiryDate: product.expiryDate,
                            barcode: product.barcode
                        }
                    });
                }
            }
            saveToLocalStorage();
            checkAndGenerateAlerts();
            
            // FIX: Refresh product grid immediately
            loadProducts();
            
            if (currentPage === 'inventory') loadInventory();
            if (currentPage === 'stock') loadStockCheck();
            
            setTimeout(() => { try { processSyncQueue(); } catch (_) {} }, 300);
            showReceipt(result.sale);
            cart = [];
            updateCart();
            loadSales();
            showNotification('Sale completed successfully', 'success');
        } else {
            showNotification('Failed to complete sale', 'error');
        }
    } catch (error) {
        console.error('Error completing sale:', error);
        showNotification('Error completing sale', 'error');
    } finally {
        completeSaleBtn.classList.remove('loading');
        completeSaleBtn.disabled = false;
    }
}

function showReceipt(sale) {
    const receiptContent = document.getElementById('receipt-content');
    if (!receiptContent) return;
    let itemsHtml = '';
    sale.items.forEach(item => {
        itemsHtml += `<div class="receipt-item"><span>${item.name} x${item.quantity}</span><span>${formatCurrency(item.price * item.quantity)}</span></div>`;
    });
    receiptContent.innerHTML = `
        <div class="receipt-header">
            <h2>${settings.storeName}</h2>
            <p>${settings.storeAddress}</p>
            <p>${settings.storePhone}</p>
        </div>
        <div class="receipt-items">${itemsHtml}</div>
        <div class="receipt-footer">
            <div class="receipt-total"><span>Total:</span><span>${formatCurrency(sale.total)}</span></div>
            <div class="receipt-item"><span>Receipt #:</span><span>${sale.receiptNumber}</span></div>
            <div class="receipt-item"><span>Date:</span><span>${formatDate(sale.created_at)}</span></div>
            <div class="receipt-item"><span>Cashier:</span><span>${sale.cashier}</span></div>
            <div class="receipt-item"><span>Payment:</span><span>${(sale.paymentMethod || 'cash').toUpperCase()}</span></div>
        </div>
    `;
    receiptModal.style.display = 'flex';
}

function printReceipt() {
    const receiptContent = document.getElementById('receipt-content');
    if (!receiptContent) return;
    const content = receiptContent.innerHTML;
    const printWindow = window.open('', '_blank');
    printWindow.document.write(`<html><head><title>Receipt - ${settings.storeName}</title><style>body { font-family: 'Courier New', monospace; padding: 20px; } .receipt-header { text-align: center; margin-bottom: 20px; } .receipt-items { margin-bottom: 20px; } .receipt-item { display: flex; justify-content: space-between; margin-bottom: 8px; } .receipt-footer { border-top: 1px dashed #ccc; padding-top: 10px; } .receipt-total { display: flex; justify-content: space-between; font-weight: 700; margin-bottom: 5px; }</style></head><body>${content}</body></html>`);
    printWindow.document.close();
    printWindow.print();
}

// Product Modal Functions
function openProductModal(product = null) {
    if (!AuthModule.isAdmin()) { showNotification('Only admins can add or edit products', 'error'); return; }
    const modalTitle = document.getElementById('modal-title');
    const productForm = document.getElementById('product-form');
    if (product) {
        if (modalTitle) modalTitle.textContent = 'Edit Product';
        document.getElementById('product-name').value = product.name;
        document.getElementById('product-category').value = product.category;
        document.getElementById('product-price').value = product.price;
        document.getElementById('product-stock').value = product.stock;
        document.getElementById('product-expiry').value = product.expiryDate;
        document.getElementById('product-barcode').value = product.barcode || '';
        if (productForm) productForm.dataset.productId = product.id;
    } else {
        if (modalTitle) modalTitle.textContent = 'Add New Product';
        if (productForm) { productForm.reset(); delete productForm.dataset.productId; }
    }
    productModal.style.display = 'flex';
}

function closeProductModal() { productModal.style.display = 'none'; }

async function saveProduct() {
    if (!AuthModule.isAdmin()) { showNotification('Only admins can add or edit products', 'error'); return; }
    const productForm = document.getElementById('product-form');
    if (!productForm) return;
    const productId = productForm.dataset.productId;
    const productData = validateProductData({
        name: document.getElementById('product-name').value,
        category: document.getElementById('product-category').value,
        price: parseFloat(document.getElementById('product-price').value),
        stock: parseInt(document.getElementById('product-stock').value),
        expiryDate: document.getElementById('product-expiry').value,
        barcode: document.getElementById('product-barcode').value
    });
    if (productId) productData.id = productId;
    const result = await DataModule.saveProduct(productData);
    if (result.success) {
        closeProductModal();
        products = await DataModule.fetchProducts();
        checkAndGenerateAlerts();
        loadProducts();
        if (currentPage === 'inventory') loadInventory();
        if (currentPage === 'analytics') loadStockAlerts();
        showNotification(productId ? 'Product updated successfully' : 'Product added successfully', 'success');
    }
}

function editProduct(productId) {
    if (!AuthModule.isAdmin()) { showNotification('Only admins can edit products', 'error'); return; }
    const product = products.find(p => p.id === productId);
    if (product) openProductModal(product);
}

async function deleteProduct(productId) {
    if (!AuthModule.isAdmin()) { showNotification('Only admins can delete products', 'error'); return; }
    if (!confirm('Are you sure you want to delete this product?')) return;
    const result = await DataModule.deleteProduct(productId);
    if (result.success) {
        if (isOnline) products = await DataModule.fetchAllProducts();
        else dedupeProducts();
        checkAndGenerateAlerts();
        loadProducts();
        if (currentPage === 'inventory') loadInventory();
        if (currentPage === 'analytics') loadStockAlerts();
        showNotification('Product deleted successfully', 'success');
    } else showNotification('Failed to delete product', 'error');
}

function viewSale(saleId) {
    const sale = sales.find(s => s.id === saleId);
    if (sale) showReceipt(sale);
}

async function deleteSale(saleId) {
    if (!AuthModule.isAdmin()) { showNotification('You do not have permission to delete sales', 'error'); return; }
    const sale = sales.find(s => s.id === saleId);
    if (!sale) { showNotification('Sale not found', 'error'); return; }
    const confirmMessage = `Are you sure you want to delete this sale?\n\nReceipt #: ${sale.receiptNumber}\nDate: ${formatDate(sale.created_at)}\nTotal: ${formatCurrency(sale.total)}\n\nThis action cannot be undone.`;
    if (!confirm(confirmMessage)) return;
    try {
        const result = await DataModule.deleteSale(saleId);
        if (result.success) {
            showNotification('Sale deleted successfully', 'success');
            sales = await DataModule.fetchSales();
            updateSalesTables();
            if (currentPage === 'reports') generateReport();
        } else showNotification('Failed to delete sale', 'error');
    } catch (error) { showNotification('Error deleting sale', 'error'); }
}

async function refreshAllData() {
    try {
        const syncStatus = document.getElementById('sync-status');
        if (syncStatus) { syncStatus.classList.add('show', 'syncing'); document.getElementById('sync-status-text').textContent = 'Syncing...'; }
        
        products = await DataModule.fetchAllProducts();
        sales = await DataModule.fetchSales();
        deletedSales = await DataModule.fetchDeletedSales();
        expenses = await DataModule.fetchExpenses();
        purchases = await DataModule.fetchPurchases();
        
        scheduleRender(() => checkAndGenerateAlerts());
        saveToLocalStorage();
        loadProducts();
        loadSales();
        try { generateReport(); } catch (_) {}
        if (currentPage === 'inventory') loadInventory();
        else if (currentPage === 'account') loadAccount();
        else if (currentPage === 'expenses') loadExpenses();
        else if (currentPage === 'purchases') loadPurchases();
        else if (currentPage === 'analytics') loadAnalytics();
        
        if (syncQueue.length > 0) await processSyncQueue();
        showNotification('All data synchronized successfully!', 'success');
    } catch (error) {
        console.error('Error refreshing data:', error);
        showNotification('Error syncing data. Please try again.', 'error');
    }
}

// Expense Functions
function openExpenseModal(expense = null) {
    const modalTitle = document.getElementById('expense-modal-title');
    if (expense) {
        modalTitle.textContent = 'Edit Expense';
        document.getElementById('expense-date').value = expense.date;
        document.getElementById('expense-description').value = expense.description;
        document.getElementById('expense-category').value = expense.category;
        document.getElementById('expense-amount').value = expense.amount;
        document.getElementById('expense-receipt').value = expense.receipt || '';
        document.getElementById('expense-notes').value = expense.notes || '';
        document.getElementById('expense-form').dataset.expenseId = expense.id;
    } else {
        modalTitle.textContent = 'Add Expense';
        document.getElementById('expense-form').reset();
        document.getElementById('expense-date').valueAsDate = new Date();
        delete document.getElementById('expense-form').dataset.expenseId;
    }
    document.getElementById('expense-modal').style.display = 'flex';
}
function closeExpenseModal() { document.getElementById('expense-modal').style.display = 'none'; }
async function saveExpense() {
    const expenseForm = document.getElementById('expense-form');
    const expenseId = expenseForm.dataset.expenseId;
    const expenseData = {
        date: document.getElementById('expense-date').value,
        description: document.getElementById('expense-description').value.trim(),
        category: document.getElementById('expense-category').value,
        amount: parseFloat(document.getElementById('expense-amount').value),
        receipt: document.getElementById('expense-receipt').value,
        notes: document.getElementById('expense-notes').value
    };
    if (expenseId) expenseData.id = expenseId;
    
    if (!expenseData.date || !expenseData.description || !expenseData.category || !expenseData.amount || expenseData.amount <= 0) {
        showNotification('Please fill all required fields', 'error'); return;
    }
    
    document.getElementById('expense-modal-loading').style.display = 'flex';
    document.getElementById('save-expense-btn').disabled = true;
    try {
        const result = await DataModule.saveExpense(expenseData);
        if (result.success) { closeExpenseModal(); loadExpenses(); showNotification('Expense saved', 'success'); }
        else showNotification('Failed to save expense', 'error');
    } catch (e) { showNotification('Error saving expense', 'error'); }
    finally { document.getElementById('expense-modal-loading').style.display = 'none'; document.getElementById('save-expense-btn').disabled = false; }
}
async function loadExpenses() {
    const loading = document.getElementById('expenses-loading');
    const tableBody = document.getElementById('expenses-table-body');
    loading.style.display = 'flex';
    try {
        await DataModule.fetchExpenses();
        const now = new Date();
        const currentMonth = now.getMonth();
        const currentYear = now.getFullYear();
        let monthlyTotal = 0, yearlyTotal = 0;
        expenses.forEach(expense => {
            const expenseDate = new Date(expense.date);
            if (expenseDate.getMonth() === currentMonth && expenseDate.getFullYear() === currentYear) monthlyTotal += expense.amount;
            if (expenseDate.getFullYear() === currentYear) yearlyTotal += expense.amount;
        });
        document.getElementById('monthly-expenses-total').textContent = formatCurrency(monthlyTotal);
        document.getElementById('yearly-expenses-total').textContent = formatCurrency(yearlyTotal);
        
        if (expenses.length === 0) tableBody.innerHTML = `<tr><td colspan="5" style="text-align: center;">No expenses data</td></tr>`;
        else {
            tableBody.innerHTML = '';
            expenses.slice(0, 20).forEach(expense => {
                const row = document.createElement('tr');
                row.innerHTML = `<td>${formatDate(expense.date)}</td><td>${expense.description}</td><td>${expense.category}</td><td>${formatCurrency(expense.amount)}</td><td><div class="action-buttons"><button class="btn-edit" onclick="editExpense('${expense.id}')"><i class="fas fa-edit"></i></button></div></td>`;
                tableBody.appendChild(row);
            });
        }
    } catch (error) { showNotification('Error loading expenses', 'error'); }
    finally { loading.style.display = 'none'; }
}
function editExpense(expenseId) { const expense = expenses.find(e => e.id === expenseId); if (expense) openExpenseModal(expense); }
async function deleteExpense(expenseId) {
    if (!confirm('Are you sure you want to delete this expense?')) return;
    try {
        expenses = expenses.filter(e => e.id !== expenseId);
        saveToLocalStorage();
        if (isOnline) await supabase.from('expenses').delete().eq('id', expenseId);
        else addToSyncQueue({ type: 'deleteExpense', id: expenseId });
        loadExpenses();
        showNotification('Expense deleted', 'success');
    } catch (error) { showNotification('Error deleting expense', 'error'); }
}

// Purchase Functions
function openPurchaseModal(purchase = null) {
    const modalTitle = document.getElementById('purchase-modal-title');
    if (purchase) {
        modalTitle.textContent = 'Edit Purchase';
        document.getElementById('purchase-date').value = purchase.date;
        document.getElementById('purchase-supplier').value = purchase.supplier;
        document.getElementById('purchase-description').value = purchase.description;
        document.getElementById('purchase-amount').value = purchase.amount;
        document.getElementById('purchase-invoice').value = purchase.invoice || '';
        document.getElementById('purchase-notes').value = purchase.notes || '';
        document.getElementById('purchase-form').dataset.purchaseId = purchase.id;
    } else {
        modalTitle.textContent = 'Add Purchase';
        document.getElementById('purchase-form').reset();
        document.getElementById('purchase-date').valueAsDate = new Date();
        delete document.getElementById('purchase-form').dataset.purchaseId;
    }
    document.getElementById('purchase-modal').style.display = 'flex';
}
function closePurchaseModal() { document.getElementById('purchase-modal').style.display = 'none'; }
async function savePurchase() {
    const purchaseForm = document.getElementById('purchase-form');
    const purchaseId = purchaseForm.dataset.purchaseId;
    const purchaseData = {
        date: document.getElementById('purchase-date').value,
        supplier: document.getElementById('purchase-supplier').value.trim(),
        description: document.getElementById('purchase-description').value.trim(),
        amount: parseFloat(document.getElementById('purchase-amount').value),
        invoice: document.getElementById('purchase-invoice').value,
        notes: document.getElementById('purchase-notes').value
    };
    if (purchaseId) purchaseData.id = purchaseId;
    
    if (!purchaseData.date || !purchaseData.supplier || !purchaseData.description || !purchaseData.amount || purchaseData.amount <= 0) {
        showNotification('Please fill all required fields', 'error'); return;
    }
    
    document.getElementById('purchase-modal-loading').style.display = 'flex';
    document.getElementById('save-purchase-btn').disabled = true;
    try {
        const result = await DataModule.savePurchase(purchaseData);
        if (result.success) { closePurchaseModal(); loadPurchases(); showNotification('Purchase saved', 'success'); }
        else showNotification('Failed to save purchase', 'error');
    } catch (e) { showNotification('Error saving purchase', 'error'); }
    finally { document.getElementById('purchase-modal-loading').style.display = 'none'; document.getElementById('save-purchase-btn').disabled = false; }
}
async function loadPurchases() {
    const loading = document.getElementById('purchases-loading');
    const tableBody = document.getElementById('purchases-table-body');
    loading.style.display = 'flex';
    try {
        await DataModule.fetchPurchases();
        const now = new Date();
        let monthlyTotal = 0, yearlyTotal = 0;
        const suppliers = new Set();
        purchases.forEach(purchase => {
            const purchaseDate = new Date(purchase.date);
            if (purchaseDate.getMonth() === now.getMonth() && purchaseDate.getFullYear() === now.getFullYear()) monthlyTotal += purchase.amount;
            if (purchaseDate.getFullYear() === now.getFullYear()) yearlyTotal += purchase.amount;
            suppliers.add(purchase.supplier);
        });
        document.getElementById('monthly-purchases-total').textContent = formatCurrency(monthlyTotal);
        document.getElementById('yearly-purchases-total').textContent = formatCurrency(yearlyTotal);
        document.getElementById('total-suppliers').textContent = suppliers.size;
        
        if (purchases.length === 0) tableBody.innerHTML = `<tr><td colspan="5" style="text-align: center;">No purchases data</td></tr>`;
        else {
            tableBody.innerHTML = '';
            purchases.slice(0, 20).forEach(purchase => {
                const row = document.createElement('tr');
                row.innerHTML = `<td>${formatDate(purchase.date)}</td><td>${purchase.supplier}</td><td>${purchase.description}</td><td>${formatCurrency(purchase.amount)}</td><td><div class="action-buttons"><button class="btn-edit" onclick="editPurchase('${purchase.id}')"><i class="fas fa-edit"></i></button></div></td>`;
                tableBody.appendChild(row);
            });
        }
    } catch (error) { showNotification('Error loading purchases', 'error'); }
    finally { loading.style.display = 'none'; }
}
function editPurchase(purchaseId) { const purchase = purchases.find(p => p.id === purchaseId); if (purchase) openPurchaseModal(purchase); }
async function deletePurchase(purchaseId) {
    if (!confirm('Are you sure you want to delete this purchase?')) return;
    try {
        purchases = purchases.filter(p => p.id !== purchaseId);
        saveToLocalStorage();
        if (isOnline) await supabase.from('purchases').delete().eq('id', purchaseId);
        else addToSyncQueue({ type: 'deletePurchase', id: purchaseId });
        loadPurchases();
        showNotification('Purchase deleted', 'success');
    } catch (error) { showNotification('Error deleting purchase', 'error'); }
}

// Analytics & Alerts
function loadStockAlerts() {
    const lowStockLoading = document.getElementById('stock-alerts-loading');
    const stockAlertsList = document.getElementById('stock-alerts-list');
    if (lowStockLoading) lowStockLoading.style.display = 'flex';
    try {
        const result = checkAndGenerateAlerts();
        const allAlerts = result.all;
        const byType = result.byType;
        document.getElementById('expired-badge').textContent = byType.expired.length;
        document.getElementById('expiring-soon-badge').textContent = byType.expiringSoon.length;
        document.getElementById('low-stock-badge').textContent = byType.lowStock.length + byType.outOfStock.length;
        
        const acknowledgedAlerts = readArrayFromLS('acknowledgedAlerts');
        const groups = [
            { title: `Expired (${byType.expired.length})`, items: byType.expired },
            { title: `Expiring Soon (${byType.expiringSoon.length})`, items: byType.expiringSoon },
            { title: `Low Stock (${byType.lowStock.length})`, items: byType.lowStock },
            { title: `Out of Stock (${byType.outOfStock.length})`, items: byType.outOfStock }
        ];
        const totalItems = allAlerts.length;
        if (totalItems === 0) stockAlertsList.innerHTML = '<p>No stock alerts</p>';
        else {
            stockAlertsList.innerHTML = '';
            groups.forEach(group => {
                if (!group.items || group.items.length === 0) return;
                const section = document.createElement('div');
                section.className = 'alert-group';
                const header = document.createElement('h4');
                header.textContent = group.title;
                section.appendChild(header);
                group.items.forEach(alert => {
                    if (acknowledgedAlerts.includes(alert.id)) return;
                    const alertDiv = document.createElement('div');
                    alertDiv.className = `alert-item ${alert.severity}`;
                    const secondary = alert.expiryDate ? `Expires on: ${formatDate(alert.expiryDate)}` : `Stock: ${alert.currentStock}`;
                    alertDiv.innerHTML = `
                        <div class="alert-icon"><i class="${alert.severity === 'critical' ? 'fas fa-times-circle' : 'fas fa-exclamation-triangle'}"></i></div>
                        <div class="alert-content">
                            <div class="alert-title">${alert.name}</div>
                            <div class="alert-message">${alert.message}</div>
                            <div class="alert-time">${secondary}</div>
                        </div>
                        <div class="alert-actions">
                            <button class="btn btn-sm btn-primary" onclick="viewProduct('${alert.id}')">View</button>
                            <button class="btn btn-sm btn-secondary" onclick="acknowledgeAlert('${alert.id}')">Acknowledge</button>
                        </div>
                    `;
                    section.appendChild(alertDiv);
                });
                stockAlertsList.appendChild(section);
            });
        }
    } catch (error) { console.error('Error loading stock alerts:', error); stockAlertsList.innerHTML = '<p>Error loading stock alerts</p>'; }
    finally { if (lowStockLoading) lowStockLoading.style.display = 'none'; }
}

function loadDiscrepancies() {
    const loading = document.getElementById('discrepancies-loading');
    const discrepanciesList = document.getElementById('discrepancies-list');
    if (loading) loading.style.display = 'flex';
    try {
        const discrepancies = DataModule.detectDiscrepancies();
        const resolvedDiscrepancies = JSON.parse(localStorage.getItem('resolvedDiscrepancies') || '[]');
        if (discrepancies.length === 0) discrepanciesList.innerHTML = '<p>No discrepancies found</p>';
        else {
            discrepanciesList.innerHTML = '';
            discrepancies.forEach(discrepancy => {
                if (resolvedDiscrepancies.includes(discrepancy.id)) return;
                const discrepancyDiv = document.createElement('div');
                discrepancyDiv.className = 'alert-item discrepancy';
                discrepancyDiv.innerHTML = `
                    <div class="alert-icon"><i class="fas fa-exclamation-circle"></i></div>
                    <div class="alert-content">
                        <div class="alert-message">${discrepancy.message}</div>
                        <div class="alert-time">${formatDate(discrepancy.created_at)}</div>
                    </div>
                    <div class="alert-actions">
                        <button class="btn btn-sm btn-secondary" onclick="resolveDiscrepancy('${discrepancy.id}', '${discrepancy.type}')">Resolve</button>
                    </div>
                `;
                discrepanciesList.appendChild(discrepancyDiv);
            });
        }
    } catch (error) { console.error('Error loading discrepancies:', error); discrepanciesList.innerHTML = '<p>Error loading discrepancies</p>'; }
    finally { if (loading) loading.style.display = 'none'; }
}

async function loadAnalytics() {
    const loading = document.getElementById('analytics-loading');
    if (loading) loading.style.display = 'flex';
    try {
        const period = document.getElementById('analytics-period').value;
        let startDate, endDate;
        const today = new Date();
        endDate = today.toISOString().split('T')[0];
        if (period === 'week') { startDate = new Date(today); startDate.setDate(today.getDate() - 7); startDate = startDate.toISOString().split('T')[0]; }
        else if (period === 'month') { startDate = new Date(today.getFullYear(), today.getMonth(), 1).toISOString().split('T')[0]; }
        else if (period === 'quarter') { const quarter = Math.floor(today.getMonth() / 3); startDate = new Date(today.getFullYear(), quarter * 3, 1).toISOString().split('T')[0]; }
        else if (period === 'year') { startDate = new Date(today.getFullYear(), 0, 1).toISOString().split('T')[0]; }
        else if (period === 'custom') { startDate = document.getElementById('analytics-start-date').value; endDate = document.getElementById('analytics-end-date').value; }
        
        const profitInfo = DataModule.calculateProfit(startDate, endDate);
        
        document.getElementById('analytics-revenue').textContent = formatCurrency(profitInfo.revenue);
        document.getElementById('analytics-expenses').textContent = formatCurrency(profitInfo.expenses);
        document.getElementById('analytics-purchases').textContent = formatCurrency(profitInfo.purchases);
        document.getElementById('analytics-profit').textContent = formatCurrency(profitInfo.profit);
        const profitMargin = profitInfo.revenue > 0 ? (profitInfo.profit / profitInfo.revenue * 100).toFixed(2) : 0;
        document.getElementById('analytics-profit-margin').textContent = `${profitMargin}%`;
        
        loadStockAlerts();
        loadDiscrepancies();
    } catch (error) { console.error('Error loading analytics:', error); showNotification('Error loading analytics', 'error'); }
    finally { if (loading) loading.style.display = 'none'; }
}

function handleAnalyticsPeriodChange() {
    const period = document.getElementById('analytics-period').value;
    const customDateRange = document.getElementById('custom-date-range');
    if (period === 'custom') {
        customDateRange.style.display = 'flex';
        const today = new Date();
        const lastMonth = new Date(today); lastMonth.setMonth(today.getMonth() - 1);
        document.getElementById('analytics-start-date').valueAsDate = lastMonth;
        document.getElementById('analytics-end-date').valueAsDate = today;
    } else customDateRange.style.display = 'none';
    loadAnalytics();
}

function viewProduct(productId) {
    const product = products.find(p => p.id === productId);
    if (product) {
        showPage('inventory');
        loadInventory();
        setTimeout(() => {
            const row = document.querySelector(`#inventory-table-body tr td:first-child:contains('${productId}')`);
            if (row) { row.parentElement.scrollIntoView({ behavior: 'smooth', block: 'center' }); row.parentElement.classList.add('highlight'); setTimeout(() => row.parentElement.classList.remove('highlight'), 3000); }
        }, 500);
    }
}

function updateInventoryTotalFromAllProducts() {
    const inventoryTotalValue = document.getElementById('inventory-total-value');
    if (inventoryTotalValue) {
        const totalValue = products.filter(p => !p.deleted).reduce((sum, p) => sum + ((Number(p.price) || 0) * (Number(p.stock) || 0)), 0);
        inventoryTotalValue.textContent = formatCurrency(totalValue);
    }
}

// Event Listeners
loginForm.addEventListener('submit', (e) => {
    e.preventDefault();
    const email = document.getElementById('login-email').value;
    const password = document.getElementById('login-password').value;
    AuthModule.signIn(email, password);
});
registerForm.addEventListener('submit', (e) => {
    e.preventDefault();
    const name = document.getElementById('register-name').value;
    const email = document.getElementById('register-email').value;
    const password = document.getElementById('register-password').value;
    const confirmPassword = document.getElementById('register-confirm-password').value;
    const role = document.getElementById('register-role').value;
    if (password !== confirmPassword) {
        document.getElementById('register-error').style.display = 'block';
        document.getElementById('register-error').textContent = 'Passwords do not match';
        return;
    }
    document.getElementById('register-submit-btn').classList.add('loading');
    document.getElementById('register-submit-btn').disabled = true;
    AuthModule.signUp(email, password, name, role).then(result => {
        if (result.success) { document.querySelector('[data-tab="login"]').click(); registerForm.reset(); }
    }).finally(() => {
        document.getElementById('register-submit-btn').classList.remove('loading');
        document.getElementById('register-submit-btn').disabled = false;
    });
});
document.querySelectorAll('.login-tab').forEach(tab => {
    tab.addEventListener('click', () => {
        const tabName = tab.getAttribute('data-tab');
        document.querySelectorAll('.login-tab').forEach(t => t.classList.remove('active'));
        tab.classList.add('active');
        document.querySelectorAll('.tab-content').forEach(content => {
            content.classList.remove('active');
            if (content.id === `${tabName}-tab` || content.id === `${tabName}-content`) content.classList.add('active');
        });
        document.getElementById('login-error').style.display = 'none';
        document.getElementById('register-error').style.display = 'none';
    });
});
navLinks.forEach(link => { link.addEventListener('click', (e) => { e.preventDefault(); showPage(link.getAttribute('data-page')); }); });
if (mobileMenuBtn) mobileMenuBtn.addEventListener('click', () => { sidebar.classList.toggle('active'); });
if (logoutBtn) logoutBtn.addEventListener('click', () => { if (confirm('Are you sure you want to logout?')) AuthModule.signOut(); });

// Product search
function applyProductSearch(searchTerm) {
    const term = (searchTerm || '').toLowerCase();
    if (!term) { loadProducts(); return; }
    const filteredProducts = products.filter(product => {
        const name = (product && product.name ? product.name :
            function applyProductSearch(searchTerm) {
                const term = (searchTerm || '').toLowerCase();
                if (!term) {
                    loadProducts();
                    return;
                }
                
                const filteredProducts = products.filter(product => {
                    const name = (product && product.name ? product.name : '').toLowerCase();
                    const category = (product && product.category ? product.category : '').toLowerCase();
                    const barcode = (product && typeof product.barcode === 'string') ? product.barcode.toLowerCase() : '';
                    return name.includes(term) || category.includes(term) || barcode.includes(term);
                });
                
                if (filteredProducts.length === 0) {
                    productsGrid.innerHTML = `
                        <div class="empty-state">
                            <i class="fas fa-search"></i>
                            <h3>No products found</h3>
                            <p>Try a different search term</p>
                        </div>
                    `;
                    return;
                }
                
                productsGrid.innerHTML = '';
                const fragment = document.createDocumentFragment();
                const today = new Date();
                
                filteredProducts.forEach(product => {
                    if (product.deleted) return;
                    const productCard = document.createElement('div');
                    productCard.className = 'product-card';
                    const expiryDate = new Date(product.expiryDate);
                    const daysUntilExpiry = Math.ceil((expiryDate - today) / (1000 * 60 * 60 * 24));
                    let expiryWarning = '';
                    let productNameStyle = '';
                    if (daysUntilExpiry < 0) {
                        expiryWarning = `<div class="expiry-warning"><i class="fas fa-exclamation-triangle"></i> Expired</div>`;
                        productNameStyle = 'style="color: red; font-weight: bold;"';
                    } else if (daysUntilExpiry <= settings.expiryWarningDays) {
                        expiryWarning = `<div class="expiry-warning"><i class="fas fa-clock"></i> Expires in ${daysUntilExpiry} days</div>`;
                        productNameStyle = 'style="color: red; font-weight: bold;"';
                    }
                    let stockClass = 'stock-high';
                    if (product.stock <= 0) {
                        stockClass = 'stock-low';
                    } else if (product.stock <= settings.lowStockThreshold) {
                        stockClass = 'stock-medium';
                    }
                    productCard.innerHTML = `
                        <div class="product-img"><i class="fas fa-box"></i></div>
                        <h4 ${productNameStyle}>${product.name}</h4>
                        <div class="price">${formatCurrency(product.price)}</div>
                        <div class="stock ${stockClass}">Stock: ${product.stock}</div>
                        ${expiryWarning}
                    `;
                    productCard.addEventListener('click', () => addToCart(product));
                    fragment.appendChild(productCard);
                });
                productsGrid.appendChild(fragment);
            }
            
            const searchBtn = document.getElementById('search-btn');
            if (searchBtn) {
                searchBtn.addEventListener('click', () => {
                    const productSearchEl = document.getElementById('product-search');
                    applyProductSearch(productSearchEl ? productSearchEl.value : '');
                });
            }
            
            const productSearchEl = document.getElementById('product-search');
            if (productSearchEl) {
                productSearchEl.addEventListener('input', debounce(() => {
                    applyProductSearch(productSearchEl.value);
                }, 150));
            }
            
            // Inventory search
            function applyInventorySearch(searchTerm) {
                const term = (searchTerm || '').toLowerCase();
                if (!term) {
                    loadInventory();
                    return;
                }
                
                const filteredProducts = products.filter(product => {
                    const name = (product && product.name ? product.name : '').toLowerCase();
                    const category = (product && product.category ? product.category : '').toLowerCase();
                    const idStr = (product && product.id != null) ? String(product.id).toLowerCase() : '';
                    return name.includes(term) || category.includes(term) || idStr.includes(term);
                });
                
                if (filteredProducts.length === 0) {
                    inventoryTableBody.innerHTML = `<tr><td colspan="8" style="text-align: center;">No products found</td></tr>`;
                    const inventoryTotalValue = document.getElementById('inventory-total-value');
                    if (inventoryTotalValue) inventoryTotalValue.textContent = formatCurrency(0);
                    return;
                }
                
                renderInventoryList(filteredProducts);
                const totalValue = filteredProducts.reduce((sum, p) => sum + ((Number(p.price) || 0) * (Number(p.stock) || 0)), 0);
                const inventoryTotalValue = document.getElementById('inventory-total-value');
                if (inventoryTotalValue) inventoryTotalValue.textContent = formatCurrency(totalValue);
            }
            
            function renderInventoryList(list) {
                const msPerDay = 1000 * 60 * 60 * 24;
                const todayTs = Date.now();
                const chunkSize = 400;
                let index = 0;
                const mySeq = ++inventoryRenderSeq;
                inventoryTableBody.innerHTML = '';
                const seenKeys = new Set();
                
                function renderChunk() {
                    if (mySeq !== inventoryRenderSeq) return;
                    let html = '';
                    for (let i = 0; i < chunkSize && index < list.length; i++, index++) {
                        const product = list[index];
                        if (!product || seenKeys.has(productKeyNCP(product))) continue;
                        seenKeys.add(productKeyNCP(product));
                        if (product.deleted) continue;
                        
                        const daysUntilExpiry = Math.ceil((Date.parse(product.expiryDate) - todayTs) / msPerDay);
                        let rowClass = '', stockBadgeClass = 'stock-high', stockBadgeText = 'In Stock';
                        let expiryBadgeClass = 'expiry-good', expiryBadgeText = 'Good', productNameStyle = '';
                        
                        if (product.stock <= 0) { stockBadgeClass = 'stock-low'; stockBadgeText = 'Out of Stock'; }
                        else if (product.stock <= settings.lowStockThreshold) { stockBadgeClass = 'stock-medium'; stockBadgeText = 'Low Stock'; }
                        
                        if (daysUntilExpiry < 0) {
                            expiryBadgeClass = 'expiry-expired'; expiryBadgeText = 'Expired'; rowClass = 'expired';
                            productNameStyle = 'style="color: red; font-weight: bold;"';
                        } else if (daysUntilExpiry <= settings.expiryWarningDays) {
                            expiryBadgeClass = 'expiry-warning'; expiryBadgeText = 'Expiring Soon'; rowClass = 'expiring-soon';
                            productNameStyle = 'style="color: red; font-weight: bold;"';
                        }
                        
                        let actionButtons = AuthModule.isAdmin() ? 
                            `<div class="action-buttons">
                                <button class="btn-edit" onclick="editProduct('${product.id}')"><i class="fas fa-edit"></i></button>
                                <button class="btn-delete" onclick="deleteProduct('${product.id}')"><i class="fas fa-trash"></i></button>
                            </div>` : '<span class="no-permission">Admin only</span>';
                        
                        html += `<tr class="${rowClass}">
                            <td>${product.id}</td>
                            <td ${productNameStyle}>${product.name}</td>
                            <td>${product.category}</td>
                            <td>${formatCurrency(product.price)}</td>
                            <td>${product.stock}</td>
                            <td>${formatDate(product.expiryDate)}</td>
                            <td>
                                <span class="stock-badge ${stockBadgeClass}">${stockBadgeText}</span>
                                <span class="expiry-badge ${expiryBadgeClass}">${expiryBadgeText}</span>
                            </td>
                            <td>${actionButtons}</td>
                        </tr>`;
                    }
                    if (html) inventoryTableBody.insertAdjacentHTML('beforeend', html);
                    if (index < list.length) requestAnimationFrame(renderChunk);
                }
                requestAnimationFrame(renderChunk);
            }
            
            const inventorySearchBtn = document.getElementById('inventory-search-btn');
            if (inventorySearchBtn) {
                inventorySearchBtn.addEventListener('click', () => {
                    applyInventorySearch(document.getElementById('inventory-search').value);
                });
            }
            
            const inventorySearchEl = document.getElementById('inventory-search');
            if (inventorySearchEl) {
                inventorySearchEl.addEventListener('input', debounce(() => {
                    applyInventorySearch(inventorySearchEl.value);
                }, 150));
            }
            
            // Product buttons
            const addProductBtn = document.getElementById('add-product-btn');
            if (addProductBtn) addProductBtn.addEventListener('click', () => openProductModal());
            const addInventoryBtn = document.getElementById('add-inventory-btn');
            if (addInventoryBtn) addInventoryBtn.addEventListener('click', () => openProductModal());
            const saveProductBtn = document.getElementById('save-product-btn');
            if (saveProductBtn) saveProductBtn.addEventListener('click', saveProduct);
            const cancelProductBtn = document.getElementById('cancel-product-btn');
            if (cancelProductBtn) cancelProductBtn.addEventListener('click', closeProductModal);
            
            // Cart buttons
            const clearCartBtn = document.getElementById('clear-cart-btn');
            if (clearCartBtn) {
                clearCartBtn.addEventListener('click', () => {
                    if (confirm('Are you sure you want to clear cart?')) clearCart();
                });
            }
            const completeSaleBtn = document.getElementById('complete-sale-btn');
            if (completeSaleBtn) completeSaleBtn.addEventListener('click', completeSale);
            
            // Receipt modal buttons
            const printReceiptBtn = document.getElementById('print-receipt-btn');
            if (printReceiptBtn) printReceiptBtn.addEventListener('click', printReceipt);
            const newSaleBtn = document.getElementById('new-sale-btn');
            if (newSaleBtn) newSaleBtn.addEventListener('click', () => receiptModal.style.display = 'none');
            
            // Report generation
            const generateReportBtn = document.getElementById('generate-report-btn');
            if (generateReportBtn) generateReportBtn.addEventListener('click', generateReport);
            
            // Manual sync button
            const manualSyncBtn = document.getElementById('manual-sync-btn');
            if (manualSyncBtn) {
                manualSyncBtn.addEventListener('click', () => {
                    if (isOnline && syncQueue.length > 0) processSyncQueue();
                    else if (!isOnline) showNotification('Cannot sync while offline', 'warning');
                    else showNotification('No data to sync', 'info');
                });
            }
            
            // Refresh report button
            const refreshReportBtn = document.getElementById('refresh-report-btn');
            if (refreshReportBtn) {
                refreshReportBtn.addEventListener('click', async () => {
                    const reportsLoading = document.getElementById('reports-loading');
                    if (reportsLoading) reportsLoading.style.display = 'flex';
                    try {
                        await refreshAllData();
                        generateReport();
                        showNotification('Report data refreshed', 'success');
                    } catch (error) {
                        showNotification('Error refreshing report data', 'error');
                    } finally {
                        if (reportsLoading) reportsLoading.style.display = 'none';
                    }
                });
            }
            
            // Modal close buttons
            document.querySelectorAll('.modal-close').forEach(btn => {
                btn.addEventListener('click', () => btn.closest('.modal').style.display = 'none');
            });
            
            // Change password form
            const changePasswordForm = document.getElementById('change-password-form');
            if (changePasswordForm) {
                changePasswordForm.addEventListener('submit', async (e) => {
                    e.preventDefault();
                    const currentPassword = document.getElementById('current-password').value;
                    const newPassword = document.getElementById('new-password').value;
                    const confirmPassword = document.getElementById('confirm-new-password').value;
                    
                    if (newPassword !== confirmPassword) {
                        showNotification('Passwords do not match', 'error');
                        return;
                    }
                    
                    const changePasswordBtn = document.getElementById('change-password-btn');
                    changePasswordBtn.classList.add('loading');
                    changePasswordBtn.disabled = true;
                    try {
                        const { error: signInError } = await supabase.auth.signInWithPassword({
                            email: currentUser.email,
                            password: currentPassword
                        });
                        if (signInError) throw signInError;
                        
                        const { error: updateError } = await supabase.auth.updateUser({ password: newPassword });
                        if (updateError) throw updateError;
                        
                        showNotification('Password changed successfully', 'success');
                        changePasswordForm.reset();
                    } catch (error) {
                        showNotification('Failed to change password: ' + error.message, 'error');
                    } finally {
                        changePasswordBtn.classList.remove('loading');
                        changePasswordBtn.disabled = false;
                    }
                });
            }
            
            // Expense page event listeners
            document.getElementById('add-expense-btn').addEventListener('click', openExpenseModal);
            document.getElementById('refresh-expenses-btn').addEventListener('click', async () => { await loadExpenses(); showNotification('Expenses refreshed', 'success'); });
            document.getElementById('expense-search').addEventListener('input', filterExpenses);
            document.getElementById('expense-filter-category').addEventListener('change', filterExpenses);
            document.getElementById('expense-filter-date').addEventListener('change', filterExpenses);
            
            // Purchase page event listeners
            document.getElementById('add-purchase-btn').addEventListener('click', openPurchaseModal);
            document.getElementById('refresh-purchases-btn').addEventListener('click', async () => { await loadPurchases(); showNotification('Purchases refreshed', 'success'); });
            document.getElementById('purchase-search').addEventListener('input', filterPurchases);
            document.getElementById('purchase-filter-date').addEventListener('change', filterPurchases);
            
            // Analytics page event listeners
            document.getElementById('refresh-analytics-btn').addEventListener('click', async () => { await loadAnalytics(); showNotification('Analytics refreshed', 'success'); });
            document.getElementById('analytics-period').addEventListener('change', handleAnalyticsPeriodChange);
            
            // Tab switching for analytics page
            document.querySelectorAll('.tab-btn').forEach(btn => {
                btn.addEventListener('click', () => {
                    const tabName = btn.getAttribute('data-tab');
                    document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
                    btn.classList.add('active');
                    document.querySelectorAll('.tab-pane').forEach(pane => pane.classList.remove('active'));
                    document.getElementById(`${tabName}-tab`).classList.add('active');
                });
            });
            
            // Modal event listeners
            document.querySelector('#expense-modal .modal-close').addEventListener('click', closeExpenseModal);
            document.getElementById('cancel-expense-btn').addEventListener('click', closeExpenseModal);
            document.getElementById('save-expense-btn').addEventListener('click', saveExpense);
            
            document.querySelector('#purchase-modal .modal-close').addEventListener('click', closePurchaseModal);
            document.getElementById('cancel-purchase-btn').addEventListener('click', closePurchaseModal);
            document.getElementById('save-purchase-btn').addEventListener('click', savePurchase);
            
            // Admin: Add User modal
            function openUserModal() {
                if (!AuthModule.isAdmin()) { showNotification('Only admins can create users', 'error'); return; }
                document.getElementById('user-form').reset();
                const err = document.getElementById('user-create-error');
                if (err) { err.style.display = 'none'; err.textContent = '-'; }
                document.getElementById('user-modal').style.display = 'flex';
            }
            function closeUserModal() { document.getElementById('user-modal').style.display = 'none'; }
            async function saveUserAdmin() {
                try {
                    if (!AuthModule.isAdmin()) { showNotification('Only admins can create users', 'error'); return; }
                    const name = document.getElementById('user-name-input').value.trim();
                    const email = document.getElementById('user-email-input').value.trim();
                    const role = document.getElementById('user-role-input').value;
                    const password = document.getElementById('user-password-input').value;
                    const confirm = document.getElementById('user-password-confirm-input').value;
                    
                    if (!name || !email || !password) { showNotification('Please fill all fields', 'error'); return; }
                    if (password !== confirm) { showNotification('Passwords do not match', 'error'); return; }
                    
                    const btn = document.getElementById('save-user-btn');
                    btn.classList.add('loading'); btn.disabled = true;
                    
                    // Call the signup function (which handles admin check internally)
                    const result = await AuthModule.signUp(email, password, name, role);
                    if(result.success) {
                        closeUserModal();
                        await DataModule.fetchUsers();
                        loadUsers();
                    }
                } catch (e) {
                    const err = document.getElementById('user-create-error');
                    if (err) { err.style.display = 'block'; err.textContent = e.message || 'Failed to create user'; }
                } finally {
                    const btn = document.getElementById('save-user-btn');
                    btn.classList.remove('loading'); btn.disabled = false;
                }
            }
            const addUserBtn = document.getElementById('add-user-btn');
            if (addUserBtn) addUserBtn.addEventListener('click', openUserModal);
            const cancelUserBtn = document.getElementById('cancel-user-btn');
            if (cancelUserBtn) cancelUserBtn.addEventListener('click', closeUserModal);
            const saveUserBtn = document.getElementById('save-user-btn');
            if (saveUserBtn) saveUserBtn.addEventListener('click', saveUserAdmin);
            
            // Filter functions
            function filterExpenses() {
                const searchTerm = document.getElementById('expense-search').value.toLowerCase();
                const categoryFilter = document.getElementById('expense-filter-category').value;
                const dateFilter = document.getElementById('expense-filter-date').value;
                
                const filteredExpenses = expenses.filter(expense => {
                    let matchesSearch = !searchTerm || expense.description.toLowerCase().includes(searchTerm) || expense.notes.toLowerCase().includes(searchTerm);
                    let matchesCategory = !categoryFilter || expense.category === categoryFilter;
                    let matchesDate = !dateFilter || expense.date === dateFilter;
                    return matchesSearch && matchesCategory && matchesDate;
                });
                
                const tableBody = document.getElementById('expenses-table-body');
                if (filteredExpenses.length === 0) {
                    tableBody.innerHTML = `<tr><td colspan="5" style="text-align: center;">No expenses match filters</td></tr>`;
                } else {
                    tableBody.innerHTML = '';
                    filteredExpenses.forEach(expense => {
                        const row = document.createElement('tr');
                        row.innerHTML = `
                            <td>${formatDate(expense.date)}</td>
                            <td>${expense.description}</td>
                            <td>${expense.category}</td>
                            <td>${formatCurrency(expense.amount)}</td>
                            <td>
                                <div class="action-buttons">
                                    <button class="btn-edit" onclick="editExpense('${expense.id}')" title="Edit Expense"><i class="fas fa-edit"></i></button>
                                </div>
                            </td>
                        `;
                        tableBody.appendChild(row);
                    });
                }
            }
            
            function filterPurchases() {
                const searchTerm = document.getElementById('purchase-search').value.toLowerCase();
                const dateFilter = document.getElementById('purchase-filter-date').value;
                
                const filteredPurchases = purchases.filter(purchase => {
                    let matchesSearch = !searchTerm || purchase.supplier.toLowerCase().includes(searchTerm) || purchase.description.toLowerCase().includes(searchTerm);
                    let matchesDate = !dateFilter || purchase.date === dateFilter;
                    return matchesSearch && matchesDate;
                });
                
                const tableBody = document.getElementById('purchases-table-body');
                if (filteredPurchases.length === 0) {
                    tableBody.innerHTML = `<tr><td colspan="5" style="text-align: center;">No purchases match filters</td></tr>`;
                } else {
                    tableBody.innerHTML = '';
                    filteredPurchases.forEach(purchase => {
                        const row = document.createElement('tr');
                        row.innerHTML = `
                            <td>${formatDate(purchase.date)}</td>
                            <td>${purchase.supplier}</td>
                            <td>${purchase.description}</td>
                            <td>${formatCurrency(purchase.amount)}</td>
                            <td>
                                <div class="action-buttons">
                                    <button class="btn-edit" onclick="editPurchase('${purchase.id}')" title="Edit Purchase"><i class="fas fa-edit"></i></button>
                                </div>
                            </td>
                        `;
                        tableBody.appendChild(row);
                    });
                }
            }
            
            // Initialize app
            async function init() {
                loadFromLocalStorage();
                loadSyncQueue();
                validateDataStructure();
                cleanupDuplicateSales();
                validateSalesData();
                cleanupSyncQueue();
                checkAndGenerateAlerts();
                
                try {
                    const { data: { session } } = await supabase.auth.getSession();
                    if (session || currentUser) {
                        if (session && !currentUser) {
                            currentUser = {
                                id: session.user.id,
                                name: session.user.user_metadata?.name || session.user.email?.split('@')[0] || 'User',
                                email: session.user.email,
                                role: session.user.user_metadata?.role || 'cashier',
                                last_login: new Date().toISOString()
                            };
                            localStorage.setItem(STORAGE_KEYS.CURRENT_USER, JSON.stringify(currentUser));
                        }
                        showApp();
                    } else {
                        showLogin();
                    }
                } catch (_) {
                    showLogin();
                }
                
                showPage('pos');
                if (isOnline) checkSupabaseConnection();
                
                // Infinite scroll for products
                window.addEventListener('scroll', () => {
                    const nearBottom = (window.innerHeight + window.scrollY) >= (document.body.offsetHeight - 200);
                    if (nearBottom && isOnline && productsHasMore && !isLoadingProducts) loadMoreProducts();
                });
                
                // Check stock levels periodically
                setInterval(() => {
                    if (currentPage === 'analytics') loadStockAlerts();
                }, 60000);
                
                // Refresh session every 30 minutes
                setInterval(async () => {
                    if (currentUser) {
                        try {
                            const { error } = await supabase.auth.refreshSession();
                            if (error) console.warn('Session refresh failed:', error);
                        } catch (e) { console.warn('Session refresh exception:', e); }
                    }
                }, 30 * 60 * 1000);
            }
            
            async function loadMoreProducts() {
                try {
                    isLoadingProducts = true;
                    const newList = await DataModule.fetchProducts(productsOffset, PRODUCTS_PAGE_SIZE);
                    if (Array.isArray(newList) && newList.length > 0) {
                        loadProducts();
                        if (currentPage === 'inventory') loadInventory();
                    }
                } catch (e) { console.warn('Load more products failed:', e); }
                finally { isLoadingProducts = false; }
            }
            
            // Start app
            init();
            
            // Global Exports for HTML onclick handlers
            window.viewSale = viewSale;
            window.deleteSale = deleteSale;
            window.editProduct = editProduct;
            window.deleteProduct = deleteProduct;
            window.filterInventoryByCategory = filterInventoryByCategory;
            window.updateQuantity = updateQuantity;
            window.editExpense = editExpense;
            window.deleteExpense = deleteExpense;
            window.editPurchase = editPurchase;
            window.deletePurchase = deletePurchase;
            window.viewProduct = viewProduct;
            window.acknowledgeAlert = acknowledgeAlert;
            window.resolveDiscrepancy = resolveDiscrepancy;
            window.updateUserRole = updateUserRole;
            window.deleteUser = deleteUser;
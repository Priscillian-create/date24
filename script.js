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
        // Group by category
        const groups = new Map();
        for (const p of items) {
            const cat = (p.category || 'Uncategorized').toString();
            if (!groups.has(cat)) groups.set(cat, []);
            groups.get(cat).push(p);
        }
        // Sort categories and products
        const categories = Array.from(groups.keys()).sort((a,b) => a.localeCompare(b));
        categories.forEach(cat => {
            groups.get(cat).sort((a,b) => {
                const an = (a.name || '').toString().toLowerCase();
                const bn = (b.name || '').toString().toLowerCase();
                return an.localeCompare(bn);
            });
        });
        // Render
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
// Removed pagination view mode to keep inventory consistent

// Settings - Changed from const to let to allow reassignment
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

// Function to acknowledge an alert
function acknowledgeAlert(productId) {
    const acknowledgedAlerts = readArrayFromLS('acknowledgedAlerts');
    
    if (!acknowledgedAlerts.includes(productId)) {
        acknowledgedAlerts.push(productId);
        localStorage.setItem('acknowledgedAlerts', JSON.stringify(acknowledgedAlerts));
        showNotification('Alert acknowledged', 'success');
        
        // Refresh the alerts list
        loadStockAlerts();
    }
}

// Function to resolve a discrepancy
function resolveDiscrepancy(discrepancyId, type) {
    const resolvedDiscrepancies = readArrayFromLS('resolvedDiscrepancies');
    
    if (!resolvedDiscrepancies.includes(discrepancyId)) {
        resolvedDiscrepancies.push(discrepancyId);
        localStorage.setItem('resolvedDiscrepancies', JSON.stringify(resolvedDiscrepancies));
        showNotification('Discrepancy resolved', 'success');
        
        // Refresh the discrepancies list
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
                setTimeout(() => {
                    processSyncQueue();
                }, 2000);
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
                    const { data: newUser } = await supabase
                        .from('users')
                        .insert(fallbackUser)
                        .select()
                        .single();
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

                    // FIX: Use mergeProductData to respect local changes (stock/new items)
                    if (offset === 0) {
                        products = this.mergeProductData(activeProducts);
                        dedupeProducts();
                    } else {
                        // For pagination append
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
        
        // 1. Merge existing products (server vs local version)
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
        
        // 2. Add local-only products (new products created offline)
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
    
    mergeSalesData(serverSales) {
        const serverSalesMap = {};
        serverSales.forEach(sale => {
            serverSalesMap[sale.receiptNumber] = sale;
        });
        
        const localSalesMap = {};
        sales.forEach(sale => {
            if (sale && sale.receiptNumber) {
                localSalesMap[sale.receiptNumber] = sale;
            }
        });
        
        const mergedSales = [];
        
        serverSales.forEach(serverSale => {
            const localSale = localSalesMap[serverSale.receiptNumber];
            
            if (localSale) {
                const serverDate = new Date(serverSale.updated_at || serverSale.created_at || 0);
                const localDate = new Date(localSale.updated_at || localSale.created_at || 0);
                
                mergedSales.push(localDate > serverDate ? localSale : serverSale);
            } else {
                mergedSales.push(serverSale);
            }
        });
        
        sales.forEach(localSale => {
            if (localSale && localSale.receiptNumber && !serverSalesMap[localSale.receiptNumber]) {
                mergedSales.push(localSale);
            }
        });
        
        mergedSales.sort((a, b) => {
            const dateA = a.created_at ? new Date(a.created_at) : new Date(0);
            const dateB = b.created_at ? new Date(b.created_at) : new Date(0);
            return dateB - dateA;
        });
        
        return mergedSales;
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
            let userId = currentUser?.id;
            if (!userId || userId === 'undefined') {
                console.warn('No valid user ID found, using default');
                userId = '00000000-0000-0000-0000-000000000000';
            }
            
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
                const { data, error } = await supabase
                    .from('expenses')
                    .insert(expenseToSave)
                    .select();
                
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
                
                addToSyncQueue({
                    type: 'saveExpense',
                    data: expenseToSave
                });
                
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
            let userId = currentUser?.id;
            if (!userId || userId === 'undefined') {
                console.warn('No valid user ID found, using default');
                userId = '00000000-0000-0000-0000-000000000000';
            }
            
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
                const { data, error } = await supabase
                    .from('purchases')
                    .insert(purchaseToSave)
                    .select();
                
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
                
                addToSyncQueue({
                    type: 'savePurchase',
                    data: purchaseToSave
                });
                
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
                    message: `Low stock alert: ${product.name} has only ${product.stock} items left (threshold: ${settings.lowStockThreshold})`,
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
        if (saveProductBtn) {
            saveProductBtn.disabled = true;
        }
        
        try {
            if (!product.name || !product.category || !product.price || !product.stock || !product.expiryDate) {
                throw new Error('Please fill in all required fields');
            }
            
            if (isNaN(product.price) || product.price <= 0) {
                throw new Error('Please enter a valid price');
            }
            
            if (isNaN(product.stock) || product.stock < 0) {
                throw new Error('Please enter a valid stock quantity');
            }

            // FIX: Local First Approach
            // Always save/update in local array immediately
            if (!product.id) {
                product.id = 'temp_' + Date.now();
            }
            
            product.updated_at = new Date().toISOString(); // Set timestamp for merge logic
            
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
                    const { data, error } = await supabase
                        .from('products')
                        .update(productToSave)
                        .eq('id', product.id)
                        .select();
                    
                    if (error) throw error;
                    result = { success: true, product: (data && data[0]) || product };
                } else {
                    // Check if exists by name/price to avoid duplicates
                    const { data: exists } = await supabase
                        .from('products')
                        .select('id')
                        .eq('name', productToSave.name)
                        .eq('category', productToSave.category)
                        .eq('price', productToSave.price);
                    
                    if (exists && exists.length > 0) {
                        product.id = exists[0].id;
                        result = { success: true, product };
                    } else {
                        const { data, error } = await supabase
                            .from('products')
                            .insert(productToSave)
                            .select();
                        
                        if (error) throw error;
                        if (data && data.length > 0) {
                            // Update local temp ID to real ID
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
                // Offline: Add to sync queue
                addToSyncQueue({ type: 'saveProduct', data: product });
                return { success: true, product };
            }
            
        } catch (error) {
            console.error('Error saving product:', error);
            showNotification('Error saving product: ' + error.message, 'error');
            // Even if online sync failed, we already saved locally above (Local First)
            // So we just report error, but return success true so UI updates
            return { success: true, product }; 
        } finally {
            if (productModalLoading) productModalLoading.style.display = 'none';
            if (saveProductBtn) {
                saveProductBtn.disabled = false;
            }
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
                        const { data: matches } = await supabase
                            .from('products')
                            .select('id')
                            .eq('name', local.name)
                            .eq('category', local.category)
                            .eq('price', local.price);
                        if (matches && matches.length > 0) {
                            targetId = matches[0].id;
                        }
                    }
                    const { error: deleteError } = await supabase
                        .from('products')
                        .delete()
                        .eq('id', targetId);
                    if (deleteError) {
                        const { error: updateError } = await supabase
                            .from('products')
                            .update({ deleted: true })
                            .eq('id', targetId);
                        if (updateError) throw updateError;
                    }
                    products = products.filter(p => p.id !== productId && p.id !== targetId);
                    saveToLocalStorage();
                    return { success: true };
                } catch (dbError) {
                    console.error('Database delete failed:', dbError);
                    showNotification('Failed to delete from database. Marked as deleted locally.', 'warning');
                    addToSyncQueue({
                        type: 'deleteProduct',
                        id: productId,
                        data: { name: local?.name, category: local?.category, price: local?.price }
                    });
                    return { success: true };
                }
            } else {
                const p = products.find(x => x.id === productId) || {};
                addToSyncQueue({
                    type: 'deleteProduct',
                    id: productId,
                    data: { name: p.name, category: p.category, price: p.price }
                });
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
            if (existingSale) {
                return { success: true, sale: existingSale };
            }

            const localResult = this.saveSaleLocally(sale);

            if (isOnline) {
                try {
                    let validCashierId = currentUser?.id || '00000000-0000-0000-0000-000000000000';
                    
                    if (!validCashierId.match(/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i)) {
                        validCashierId = '00000000-0000-0000-0000-000000000000';
                    }
                    
                    const saleToSaveWithPM = {
                        receiptnumber: sale.receiptNumber,
                        cashierid: validCashierId,
                        items: sale.items,
                        total: sale.total,
                        created_at: sale.created_at,
                        cashier: sale.cashier,
                        paymentmethod: sale.paymentMethod
                    };
                    const saleToSaveNoPM = {
                        receiptnumber: sale.receiptNumber,
                        cashierid: validCashierId,
                        items: sale.items,
                        total: sale.total,
                        created_at: sale.created_at,
                        cashier: sale.cashier
                    };
                    
                    let data, error;
                    try {
                        ({ data, error } = await supabase
                            .from('sales')
                            .insert(saleToSaveWithPM)
                            .select());
                        if (error) throw error;
                    } catch (e) {
                        ({ data, error } = await supabase
                            .from('sales')
                            .insert(saleToSaveNoPM)
                            .select());
                        if (error) throw error;
                    }
                    
                    if (data && data.length > 0) {
                        const index = sales.findIndex(s => s.receiptNumber === sale.receiptNumber);
                        if (index >= 0) {
                            sales[index].id = data[0].id;
                            sales[index].cashierId = validCashierId;
                            saveToLocalStorage();
                        }
                        return { success: true, sale: { ...sale, id: data[0].id, cashierId: validCashierId } };
                    } else {
                        throw new Error('No data returned from insert operation');
                    }
                } catch (dbError) {
                    console.error('Database operation failed:', dbError);
                    showNotification('Database error: ' + dbError.message + '. Sale saved locally.', 'warning');
                    
                    addToSyncQueue({
                        type: 'saveSale',
                        data: sale
                    });
                    
                    return localResult;
                }
            } else {
                addToSyncQueue({
                    type: 'saveSale',
                    data: sale
                });
                
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
                    let { data: saleData, error: fetchError } = await supabase
                        .from('sales')
                        .select('*')
                        .eq('id', saleId)
                        .single();
                    
                    if (fetchError || !saleData) {
                        const localSale = deletedSales.find(s => s.id === saleId) || sales.find(s => s.id === saleId);
                        const receiptNo = localSale?.receiptnumber || localSale?.receiptNumber;
                        if (receiptNo) {
                            const { data: byReceipt, error: byReceiptErr } = await supabase
                                .from('sales')
                                .select('*')
                                .eq('receiptnumber', receiptNo)
                                .single();
                            if (!byReceiptErr && byReceipt) {
                                saleData = byReceipt;
                            }
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
                            const { error: insertError } = await supabase
                                .from('deleted_sales')
                                .insert(archivedSale);
                            if (insertError) {
                                let { error: updateError } = await supabase
                                    .from('sales')
                                    .update({ deleted_at: archivedSale.deleted_at })
                                    .eq('id', saleId);
                                if (updateError) {
                                    const { error: updateByReceiptErr } = await supabase
                                        .from('sales')
                                        .update({ deleted_at: archivedSale.deleted_at })
                                        .eq('receiptnumber', archivedSale.receiptnumber);
                                    if (updateByReceiptErr) throw updateByReceiptErr;
                                }
                                return { success: true };
                            }
                            let { error: deleteError } = await supabase
                                .from('sales')
                                .delete()
                                .eq('id', saleId);
                            if (deleteError) {
                                const { error: deleteByReceiptErr } = await supabase
                                    .from('sales')
                                    .delete()
                                    .eq('receiptnumber', archivedSale.receiptnumber);
                                if (deleteByReceiptErr) {
                                    let { error: updateError } = await supabase
                                        .from('sales')
                                        .update({ deleted_at: archivedSale.deleted_at })
                                        .eq('id', saleId);
                                    if (updateError) {
                                        const { error: updateByReceiptErr } = await supabase
                                            .from('sales')
                                            .update({ deleted_at: archivedSale.deleted_at })
                                            .eq('receiptnumber', archivedSale.receiptnumber);
                                        if (updateByReceiptErr) throw updateByReceiptErr;
                                    }
                                }
                                return { success: true };
                            }
                            return { success: true };
                        } else {
                            let { error: updateError } = await supabase
                                .from('sales')
                                .update({ deleted_at: archivedSale.deleted_at })
                                .eq('id', saleId);
                            if (updateError) {
                                const { error: updateByReceiptErr } = await supabase
                                    .from('sales')
                                    .update({ deleted_at: archivedSale.deleted_at })
                                    .eq('receiptnumber', archivedSale.receiptnumber);
                                if (updateByReceiptErr) throw updateByReceiptErr;
                            }
                            return { success: true };
                        }
                    } else {
                        return { success: false, error: 'Sale not found' };
                    }
                    } catch (dbError) {
                        console.error('Database delete failed:', dbError);
                        showNotification('Failed to delete from database. Marked as deleted locally.', 'warning');
                        
                        addToSyncQueue({
                            type: 'deleteSale',
                            id: saleId
                        });
                        
                        return { success: true };
                    }
                } else {
                    addToSyncQueue({
                        type: 'deleteSale',
                        id: saleId
                    });
                    
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
    if (!operation.id) {
        operation.id = 'op_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9);
    }
    
    operation.timestamp = new Date().toISOString();
    
    if (operation.type === 'saveSale') {
        const receiptNumber = operation.data.receiptNumber;
        const existingIndex = syncQueue.findIndex(op => 
            op.type === 'saveSale' && 
            op.data.receiptNumber === receiptNumber
        );
        
        if (existingIndex !== -1) {
            syncQueue[existingIndex] = operation;
        } else {
            syncQueue.push(operation);
        }
    } else if (operation.type === 'saveProduct') {
        if (operation.data.stock !== undefined && !operation.data.name) {
            const existingIndex = syncQueue.findIndex(op => 
                op.type === 'saveProduct' && 
                op.data.id === operation.data.id && 
                op.data.stock !== undefined
            );
            
            if (existingIndex !== -1) {
                syncQueue[existingIndex].data.stock = operation.data.stock;
            } else {
                syncQueue.push(operation);
            }
        } else {
            const key = operation.data && operation.data.name && operation.data.category && operation.data.price != null
                ? `${operation.data.name.toLowerCase()}|${operation.data.category.toLowerCase()}|${normalizePrice(operation.data.price)}`
                : null;
            const existingIndex = syncQueue.findIndex(op => 
                op.type === operation.type && 
                (
                    (key && op.data && `${(op.data.name||'').toLowerCase()}|${(op.data.category||'').toLowerCase()}|${normalizePrice(op.data.price)}` === key) ||
                    (!key && op.data && op.data.id === operation.data.id)
                )
            );
            
            if (existingIndex !== -1) {
                syncQueue[existingIndex] = operation;
            } else {
                syncQueue.push(operation);
            }
        }
    } else if (operation.type === 'savePurchase') {
        const key = operation.data && operation.data.date && operation.data.supplier && operation.data.amount != null
            ? `${operation.data.date}|${operation.data.supplier.toLowerCase()}|${normalizePrice(operation.data.amount)}`
            : null;
        const existingIndex = syncQueue.findIndex(op => 
            op.type === 'savePurchase' && 
            op.data && `${op.data.date}|${(op.data.supplier||'').toLowerCase()}|${normalizePrice(op.data.amount)}` === key
        );
        if (existingIndex !== -1) {
            syncQueue[existingIndex] = operation;
        } else {
            syncQueue.push(operation);
        }
    } else {
        const existingIndex = syncQueue.findIndex(op => 
            op.type === operation.type && 
            op.id === operation.id
        );
        
        if (existingIndex !== -1) {
            syncQueue[existingIndex] = operation;
        } else {
            syncQueue.push(operation);
        }
    }
    
    localStorage.setItem('syncQueue', JSON.stringify(syncQueue));
    
    if (isOnline) {
        processSyncQueue();
    } else {
        showNotification('Offline: Operation saved locally and will sync automatically.', 'info');
    }
}

async function processSyncQueue() {
    if (syncQueue.length === 0) return;
    
    const syncStatus = document.getElementById('sync-status');
    const syncStatusText = document.getElementById('sync-status-text');
    
    if (syncStatus) {
        syncStatus.classList.add('show', 'syncing');
        syncStatusText.textContent = `Syncing ${syncQueue.length} operations...`;
    }
    
    syncQueue.sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));
    
    for (let i = 0; i < syncQueue.length; i++) {
        const operation = syncQueue[i];
        
        if (operation.synced) continue;
        
        try {
            let success = false;
            
            if (operation.type === 'saveSale') {
                success = await syncSale(operation);
            } else if (operation.type === 'saveProduct') {
                success = await syncProduct(operation);
            } else if (operation.type === 'deleteProduct') {
                success = await syncDeleteProduct(operation);
            } else if (operation.type === 'deleteSale') {
                success = await syncDeleteSale(operation);
            } else if (operation.type === 'saveExpense') {
                success = await syncExpense(operation);
            } else if (operation.type === 'savePurchase') {
                success = await syncPurchase(operation);
            } else if (operation.type === 'deleteExpense') {
                success = await syncDeleteExpense(operation);
            } else if (operation.type === 'deletePurchase') {
                success = await syncDeletePurchase(operation);
            }
            
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

async function ensureValidUserId(userId) {
    if (!userId) return null;
    
    const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
    if (uuidRegex.test(userId)) {
        try {
            const { data, error } = await supabase
                .from('users')
                .select('id')
                .eq('id', userId)
                .single();
            
            if (!error && data) return userId;
        } catch (error) {
            console.error('Error checking user ID:', error);
        }
    }
    
    if (currentUser && currentUser.email) {
        try {
            const { data, error } = await supabase
                .from('users')
                .select('id')
                .eq('email', currentUser.email)
                .single();
            
            if (!error && data) {
                currentUser.id = data.id;
                localStorage.setItem(STORAGE_KEYS.CURRENT_USER, JSON.stringify(currentUser));
                return data.id;
            }
        } catch (error) {
            console.error('Error finding user by email:', error);
        }
    }
    
    return '00000000-0000-0000-0000-000000000000';
}

async function syncSale(operation) {
    try {
        let validCashierId = operation.data.cashierId || '00000000-0000-0000-0000-000000000000';
        
        if (!validCashierId.match(/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i)) {
            validCashierId = '00000000-0000-0000-0000-000000000000';
        }
        
        operation.data.cashierId = validCashierId;
        
        const { data: existingSales, error: fetchError } = await supabase
            .from('sales')
            .select('*')
            .eq('receiptnumber', operation.data.receiptNumber);
        
        if (fetchError) throw fetchError;
        
        if (!existingSales || existingSales.length === 0) {
            const saleToSaveWithPM = {
                receiptnumber: operation.data.receiptNumber,
                cashierid: validCashierId,
                items: operation.data.items,
                total: operation.data.total,
                created_at: operation.data.created_at,
                cashier: operation.data.cashier,
                paymentmethod: operation.data.paymentMethod
            };
            const saleToSaveNoPM = {
                receiptnumber: operation.data.receiptNumber,
                cashierid: validCashierId,
                items: operation.data.items,
                total: operation.data.total,
                created_at: operation.data.created_at,
                cashier: operation.data.cashier
            };
            
            let data, error;
            try {
                ({ data, error } = await supabase
                    .from('sales')
                    .insert(saleToSaveWithPM)
                    .select());
                if (error) throw error;
            } catch (e) {
                ({ data, error } = await supabase
                    .from('sales')
                    .insert(saleToSaveNoPM)
                    .select());
                if (error) throw error;
            }
            
            if (error) throw error;
            
            if (data && data.length > 0) {
                const localSaleIndex = sales.findIndex(s => s.receiptNumber === operation.data.receiptNumber);
                if (localSaleIndex !== -1) {
                    sales[localSaleIndex].id = data[0].id;
                    sales[localSaleIndex].cashierId = validCashierId;
                    saveToLocalStorage();
                }
                return true;
            }
        } else {
            if (existingSales.length > 0) {
                const localSaleIndex = sales.findIndex(s => s.receiptNumber === operation.data.receiptNumber);
                if (localSaleIndex !== -1) {
                    sales[localSaleIndex].id = existingSales[0].id;
                    sales[localSaleIndex].cashierId = validCashierId;
                    saveToLocalStorage();
                }
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
        if (operation.data.stock !== undefined && (!operation.data.name || (operation.data.id && String(operation.data.id).startsWith('temp_')))) {
            let targetId = operation.data.id;
            let name = operation.data.name;
            let category = operation.data.category;
            let price = operation.data.price;
            if (!name || !category || price == null) {
                const local = products.find(p => p.id === operation.data.id) || null;
                if (local) {
                    name = local.name;
                    category = local.category;
                    price = local.price;
                }
            }
            if (targetId && !String(targetId).startsWith('temp_')) {
                const { error } = await supabase
                    .from('products')
                    .update({ stock: operation.data.stock })
                    .eq('id', targetId);
                if (error) throw error;
            } else if (name && category && price != null) {
                const { data: existing } = await supabase
                    .from('products')
                    .select('id')
                    .eq('name', name)
                    .eq('category', category)
                    .eq('price', price);
                if (existing && existing.length > 0) {
                    targetId = existing[0].id;
                    const { error } = await supabase
                        .from('products')
                        .update({ stock: operation.data.stock })
                        .eq('id', targetId);
                    if (error) throw error;
                    const idx = products.findIndex(p => p.id === operation.data.id);
                    if (idx !== -1) {
                        products[idx].id = targetId;
                        saveToLocalStorage();
                    }
                } else {
                    return false;
                }
            } else {
                return false;
            }
        } else {
            if (operation.data.id && !operation.data.id.startsWith('temp_')) {
                const productToSave = {
                    name: operation.data.name,
                    category: operation.data.category,
                    price: operation.data.price,
                    stock: operation.data.stock,
                    expirydate: operation.data.expiryDate,
                    barcode: operation.data.barcode
                };
                
                const { error } = await supabase
                    .from('products')
                    .update(productToSave)
                    .eq('id', operation.data.id);
                
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
                try {
                    const { data: existing } = await supabase
                        .from('products')
                        .select('id')
                        .eq('name', productToSave.name)
                        .eq('category', productToSave.category)
                        .eq('price', productToSave.price);
                    if (existing && existing.length > 0) {
                        const existId = existing[0].id;
                        const localIdx = products.findIndex(p => p.id === operation.data.id);
                        if (localIdx !== -1) {
                            products[localIdx].id = existId;
                        }
                        dedupeProducts();
                        saveToLocalStorage();
                        return true;
                    }
                } catch (_) {}

                const { data, error } = await supabase
                    .from('products')
                    .insert(productToSave)
                    .select();
                
                if (error) throw error;
                
                if (data && data.length > 0) {
                    const localProductIndex = products.findIndex(p => p.id === operation.data.id);
                    if (localProductIndex !== -1) {
                        products[localProductIndex].id = data[0].id;
                    }
                    dedupeProducts();
                    saveToLocalStorage();
                }
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
                if (local) sigData = { name: local.name, category: local.category, expiryDate: local.expiryDate, barcode: local.barcode };
            }
            if (sigData && sigData.name && sigData.category && sigData.price !== undefined) {
                try {
                    const { data: matches } = await supabase
                        .from('products')
                        .select('id')
                        .eq('name', sigData.name)
                        .eq('category', sigData.category)
                        .eq('price', sigData.price);
                    if (matches && matches.length > 0) {
                        const serverId = matches[0].id;
                        const { error: delErr } = await supabase
                            .from('products')
                            .delete()
                            .eq('id', serverId);
                        if (delErr) throw delErr;
                        products = products.filter(p => p.id !== operation.id && p.id !== serverId);
                        saveToLocalStorage();
                        return true;
                    }
                } catch (_) {}
            }
            products = products.filter(p => p.id !== operation.id);
            saveToLocalStorage();
            return true;
        }
        const { error } = await supabase
            .from('products')
            .delete()
            .eq('id', operation.id);
        if (error) throw error;
        return true;
    } catch (error) {
        console.error('Error syncing product deletion:', error);
        return false;
    }
}

async function syncDeleteSale(operation) {
    try {
        let { data: saleData, error: fetchError } = await supabase
            .from('sales')
            .select('*')
            .eq('id', operation.id)
            .single();
        
        if (fetchError || !saleData) {
            const localSale = deletedSales.find(s => s.id === operation.id) || sales.find(s => s.id === operation.id);
            const receiptNo = localSale?.receiptnumber || localSale?.receiptNumber;
            if (receiptNo) {
                const { data: byReceipt, error: byReceiptErr } = await supabase
                    .from('sales')
                    .select('*')
                    .eq('receiptnumber', receiptNo)
                    .single();
                if (!byReceiptErr && byReceipt) {
                    saleData = byReceipt;
                }
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
                const { error: insertError } = await supabase
                    .from('deleted_sales')
                    .insert(archivedSale);
                if (insertError) {
                    let { error: updateError } = await supabase
                        .from('sales')
                        .update({ deleted_at: archivedSale.deleted_at })
                        .eq('id', operation.id);
                    if (updateError) {
                        const { error: updateByReceiptErr } = await supabase
                            .from('sales')
                            .update({ deleted_at: archivedSale.deleted_at })
                            .eq('receiptnumber', archivedSale.receiptnumber);
                        if (updateByReceiptErr) throw updateByReceiptErr;
                    }
                    return true;
                }
                let { error: deleteError } = await supabase
                    .from('sales')
                    .delete()
                    .eq('id', operation.id);
                if (deleteError) {
                    const { error: deleteByReceiptErr } = await supabase
                        .from('sales')
                        .delete()
                        .eq('receiptnumber', archivedSale.receiptnumber);
                    if (deleteByReceiptErr) {
                        let { error: updateError } = await supabase
                            .from('sales')
                            .update({ deleted_at: archivedSale.deleted_at })
                            .eq('id', operation.id);
                        if (updateError) {
                            const { error: updateByReceiptErr } = await supabase
                                .from('sales')
                                .update({ deleted_at: archivedSale.deleted_at })
                                .eq('receiptnumber', archivedSale.receiptnumber);
                            if (updateByReceiptErr) throw updateByReceiptErr;
                        }
                    }
                    return true;
                }
            } else {
                let { error: updateError } = await supabase
                    .from('sales')
                    .update({ deleted_at: archivedSale.deleted_at })
                    .eq('id', operation.id);
                if (updateError) {
                    const { error: updateByReceiptErr } = await supabase
                        .from('sales')
                        .update({ deleted_at: archivedSale.deleted_at })
                        .eq('receiptnumber', archivedSale.receiptnumber);
                    if (updateByReceiptErr) throw updateByReceiptErr;
                }
                return true;
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
        let userId = operation.data.created_by;
        
        if (!userId || userId === 'undefined') {
            userId = '00000000-0000-0000-0000-000000000000';
            operation.data.created_by = userId;
        }
        
        const expenseData = { ...operation.data };
        
        if (expenseData.id && expenseData.id.startsWith('temp_')) {
            delete expenseData.id;
        }
        
        const { data: existingExpenses, error: fetchError } = await supabase
            .from('expenses')
            .select('*')
            .eq('date', expenseData.date)
            .eq('description', expenseData.description)
            .eq('amount', expenseData.amount);
        
        if (fetchError) throw fetchError;
        
        if (existingExpenses && existingExpenses.length > 0) {
            const localExpenseIndex = expenses.findIndex(e => 
                e.id === operation.data.id && 
                e.date === expenseData.date && 
                e.description === expenseData.description
            );
            
            if (localExpenseIndex !== -1) {
                expenses[localExpenseIndex].id = existingExpenses[0].id;
                expenses = dedupeListByKey(expenses, expenseKey);
                saveToLocalStorage();
            }
            return true;
        }
        
        const { data, error } = await supabase
            .from('expenses')
            .insert(expenseData)
            .select();
        
        if (error) throw error;
        
        if (data && data.length > 0) {
            const localExpenseIndex = expenses.findIndex(e => e.id === operation.data.id);
            if (localExpenseIndex !== -1) {
                expenses[localExpenseIndex].id = data[0].id;
                expenses = dedupeListByKey(expenses, expenseKey);
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

async function syncDeleteExpense(operation) {
    try {
        const { error } = await supabase
            .from('expenses')
            .delete()
            .eq('id', operation.id);
        if (error) throw error;
        return true;
    } catch (error) {
        console.error('Error syncing expense deletion:', error);
        return false;
    }
}

async function syncPurchase(operation) {
    try {
        let userId = (currentUser && currentUser.id) ? currentUser.id : operation.data.created_by;
        if (!userId || userId === 'undefined') {
            userId = '00000000-0000-0000-0000-000000000000';
        }
        operation.data.created_by = userId;
        
        const purchaseData = { ...operation.data, created_by: userId };
        
        if (purchaseData.id && purchaseData.id.startsWith('temp_')) {
            delete purchaseData.id;
        }
        
        const { data: existingPurchases, error: fetchError } = await supabase
            .from('purchases')
            .select('*')
            .eq('date', purchaseData.date)
            .eq('supplier', purchaseData.supplier)
            .eq('amount', purchaseData.amount)
            .eq('created_by', userId);
        
        if (fetchError) throw fetchError;
        
        if (existingPurchases && existingPurchases.length > 0) {
            const localPurchaseIndex = purchases.findIndex(p => 
                p.id === operation.data.id && 
                p.date === purchaseData.date && 
                p.supplier === purchaseData.supplier
            );
            
            if (localPurchaseIndex !== -1) {
                purchases[localPurchaseIndex].id = existingPurchases[0].id;
                purchases = dedupeListByKey(purchases, purchaseKey);
                saveToLocalStorage();
            }
            return true;
        }
        
        const { data, error } = await supabase
            .from('purchases')
            .insert(purchaseData)
            .select();
        
        if (error) throw error;
        
        if (data && data.length > 0) {
            const localPurchaseIndex = purchases.findIndex(p => p.id === operation.data.id);
            if (localPurchaseIndex !== -1) {
                purchases[localPurchaseIndex].id = data[0].id;
                purchases = dedupeListByKey(purchases, purchaseKey);
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

async function syncDeletePurchase(operation) {
    try {
        const { error } = await supabase
            .from('purchases')
            .delete()
            .eq('id', operation.id);
        if (error) throw error;
        return true;
    } catch (error) {
        console.error('Error syncing purchase deletion:', error);
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
            
            const originalLength = syncQueue.length;
            syncQueue = syncQueue.filter(op => {
                const opDate = new Date(op.timestamp || 0);
                return opDate > weekAgo;
            });
            
            if (syncQueue.length < originalLength) {
                localStorage.setItem('syncQueue', JSON.stringify(syncQueue));
            }
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
    const v = localStorage.getItem('ARCHIVE_ENABLED');
    return v === 'true';
}
function disableArchive() {
    localStorage.setItem('ARCHIVE_ENABLED', 'false');
}

function setupRealtimeListeners() {
    if (!isOnline) return;
    if (appRealtimeChannel) return;

    const channel = supabase.channel('app-changes');

    channel.on('postgres_changes', { event: '*', schema: 'public', table: 'products' }, () => {
        DataModule.fetchAllProducts().then(updatedProducts => {
            products = updatedProducts;
            saveToLocalStorage();
            loadProducts();
            if (currentPage === 'inventory') {
                loadInventory();
            }
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

    channel.on('postgres_changes', { event: '*', schema: 'public', table: 'deleted_sales' }, () => {
        DataModule.fetchDeletedSales().then(updatedDeletedSales => {
            deletedSales = updatedDeletedSales;
            saveToLocalStorage();
            loadDeletedSales();
        });
    });

    channel.on('postgres_changes', { event: '*', schema: 'public', table: 'expenses' }, () => {
        DataModule.fetchExpenses().then(updatedExpenses => {
            expenses = updatedExpenses;
            saveToLocalStorage();
            if (currentPage === 'expenses') {
                loadExpenses();
            }
        });
    });

    channel.on('postgres_changes', { event: '*', schema: 'public', table: 'purchases' }, () => {
        DataModule.fetchPurchases().then(updatedPurchases => {
            purchases = updatedPurchases;
            saveToLocalStorage();
            if (currentPage === 'purchases') {
                loadPurchases();
            }
        });
    });

    channel.subscribe();
    appRealtimeChannel = channel;
}

// Local Storage Functions
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
        if (savedProducts) {
            try {
                const parsedProducts = JSON.parse(savedProducts);
                if (Array.isArray(parsedProducts)) {
                    products = parsedProducts;
                }
            } catch (parseError) {
                console.error('Error parsing products from localStorage:', parseError);
                products = [];
                try { localStorage.removeItem(STORAGE_KEYS.PRODUCTS); } catch (_) {}
            }
        }
        
        const savedSales = localStorage.getItem(STORAGE_KEYS.SALES);
        if (savedSales) {
            try {
                const parsedSales = JSON.parse(savedSales);
                if (Array.isArray(parsedSales)) {
                    sales = parsedSales;
                }
            } catch (parseError) {
                console.error('Error parsing sales from localStorage:', parseError);
                sales = [];
                try { localStorage.removeItem(STORAGE_KEYS.SALES); } catch (_) {}
            }
        }
        
        const savedDeletedSales = localStorage.getItem(STORAGE_KEYS.DELETED_SALES);
        if (savedDeletedSales) {
            try {
                const parsedDeletedSales = JSON.parse(savedDeletedSales);
                if (Array.isArray(parsedDeletedSales)) {
                    deletedSales = parsedDeletedSales;
                }
            } catch (parseError) {
                console.error('Error parsing deleted sales from localStorage:', parseError);
                deletedSales = [];
                try { localStorage.removeItem(STORAGE_KEYS.DELETED_SALES); } catch (_) {}
            }
        }
        
        const savedUsers = localStorage.getItem(STORAGE_KEYS.USERS);
        if (savedUsers) {
            try {
                const parsedUsers = JSON.parse(savedUsers);
                if (Array.isArray(parsedUsers)) {
                    users = parsedUsers;
                }
            } catch (parseError) {
                console.error('Error parsing users from localStorage:', parseError);
                users = [];
                try { localStorage.removeItem(STORAGE_KEYS.USERS); } catch (_) {}
            }
        }
        
        const savedSettings = localStorage.getItem(STORAGE_KEYS.SETTINGS);
        if (savedSettings) {
            try {
                const parsedSettings = JSON.parse(savedSettings);
                if (parsedSettings && typeof parsedSettings === 'object') {
                    Object.assign(settings, parsedSettings);
                }
            } catch (parseError) {
                console.error('Error parsing settings from localStorage:', parseError);
                try { localStorage.removeItem(STORAGE_KEYS.SETTINGS); } catch (_) {}
            }
        }
        
        const savedCurrentUser = localStorage.getItem(STORAGE_KEYS.CURRENT_USER);
        if (savedCurrentUser) {
            try {
                const parsedCurrentUser = JSON.parse(savedCurrentUser);
                if (parsedCurrentUser && typeof parsedCurrentUser === 'object') {
                    currentUser = parsedCurrentUser;
                }
            } catch (parseError) {
                console.error('Error parsing current user from localStorage:', parseError);
                currentUser = null;
                try { localStorage.removeItem(STORAGE_KEYS.CURRENT_USER); } catch (_) {}
            }
        }
        
        const savedExpenses = localStorage.getItem(STORAGE_KEYS.EXPENSES);
        if (savedExpenses) {
            try {
                expenses = JSON.parse(savedExpenses);
            } catch (parseError) {
                console.error('Error parsing expenses from localStorage:', parseError);
                expenses = [];
                try { localStorage.removeItem(STORAGE_KEYS.EXPENSES); } catch (_) {}
            }
        }
        
        const savedPurchases = localStorage.getItem(STORAGE_KEYS.PURCHASES);
        if (savedPurchases) {
            try {
                purchases = JSON.parse(savedPurchases);
            } catch (parseError) {
                console.error('Error parsing purchases from localStorage:', parseError);
                purchases = [];
                try { localStorage.removeItem(STORAGE_KEYS.PURCHASES); } catch (_) {}
            }
        }
        
        const savedStockAlerts = localStorage.getItem(STORAGE_KEYS.STOCK_ALERTS);
        if (savedStockAlerts) {
            try {
                stockAlerts = JSON.parse(savedStockAlerts);
            } catch (parseError) {
                console.error('Error parsing stock alerts from localStorage:', parseError);
                stockAlerts = [];
                try { localStorage.removeItem(STORAGE_KEYS.STOCK_ALERTS); } catch (_) {}
            }
        }
        
        const savedProfitData = localStorage.getItem(STORAGE_KEYS.PROFIT_DATA);
        if (savedProfitData) {
            try {
                profitData = JSON.parse(savedProfitData);
            } catch (parseError) {
                console.error('Error parsing profit data from localStorage:', parseError);
                profitData = [];
                try { localStorage.removeItem(STORAGE_KEYS.PROFIT_DATA); } catch (_) {}
            }
        }
    } catch (e) {
        console.error('Error loading data from localStorage:', e);
        products = [];
        sales = [];
        deletedSales = [];
        users = [];
        currentUser = null;
        expenses = [];
        purchases = [];
        stockAlerts = [];
        profitData = [];
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
        
        if (currentUser) {
            localStorage.setItem(STORAGE_KEYS.CURRENT_USER, JSON.stringify(currentUser));
        }
    } catch (e) {
        console.error('Error saving data to localStorage:', e);
        showNotification('Error saving data locally. Some changes may be lost.', 'error');
    }
}

function validateDataStructure() {
    let isValid = true;
    
    if (!Array.isArray(products)) {
        products = [];
        isValid = false;
    }
    
    if (!Array.isArray(sales)) {
        sales = [];
        isValid = false;
    }
    
    if (!Array.isArray(deletedSales)) {
        deletedSales = [];
        isValid = false;
    }
    
    if (!Array.isArray(users)) {
        users = [];
        isValid = false;
    }
    
    if (!Array.isArray(expenses)) {
        expenses = [];
        isValid = false;
    }
    
    if (!Array.isArray(purchases)) {
        purchases = [];
        isValid = false;
    }
    
    if (!Array.isArray(stockAlerts)) {
        stockAlerts = [];
        isValid = false;
    }
    
    if (!Array.isArray(profitData)) {
        profitData = [];
        isValid = false;
    }
    
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
    
    if (!isValid) {
        saveToLocalStorage();
    }
    
    return isValid;
}

function normalizePrice(value) {
    const n = Number(value);
    if (!isFinite(n)) return '0.00';
    return n.toFixed(2);
}

function productKeyNCP(p) {
    const barcode = (p.barcode || '').toString().trim().toLowerCase();
    if (barcode) {
      return `barcode:${barcode}`;
    }
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
          if (serverSigs.has(sig)) continue;
          if (seenServerIds.has(id)) continue;
          seenServerIds.add(id);
          serverSigs.add(sig);
          result.push(p);
        }
      }
      const tempSigs = new Set();
      for (let i = 0; i < products.length; i++) {
        const p = products[i];
        if (!p) continue;
        const id = p.id;
        if (id && !String(id).startsWith('temp_')) continue;
        const sig = productSignature(p);
        if (serverSigs.has(sig)) continue;
        if (tempSigs.has(sig)) continue;
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
        if (!key) continue;
        if (seen.has(key)) continue;
        seen.add(key);
        out.push(item);
    }
    return out;
}

function purchaseKey(p) {
    if (p && p.id && !String(p.id).startsWith('temp_')) return String(p.id);
    return `${p.date || ''}|${(p.supplier || '').toLowerCase()}|${normalizePrice(p.amount)}`;
}

function expenseKey(e) {
    return `${e.date || ''}|${(e.description || '').toLowerCase()}|${(e.category || '').toLowerCase()}|${normalizePrice(e.amount)}`;
}

function validateSalesData() {
    let isValid = true;
    
    if (!Array.isArray(sales)) {
        sales = [];
        isValid = false;
    }
    
    sales.forEach((sale, index) => {
        if (!sale || typeof sale !== 'object') {
            isValid = false;
            return;
        }
        
        if (!sale.receiptNumber) {
            isValid = false;
        }
        
        if (!sale.created_at) {
            isValid = false;
        }
        
        if (typeof sale.total !== 'number' || isNaN(sale.total)) {
            isValid = false;
        }
        
        if (!Array.isArray(sale.items)) {
            isValid = false;
        }
    });
    
    if (!isValid) {
        showNotification('Sales data validation failed. Some data may be missing.', 'warning');
    }
    
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
            usernameField.setAttribute('aria-hidden', 'true');
            usernameField.setAttribute('tabindex', '-1');
            usernameField.setAttribute('autocomplete', 'username');
            
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
        if (AuthModule.isAdmin()) {
            usersContainer.style.display = 'block';
        } else {
            usersContainer.style.display = 'none';
        }
        
        const addProductBtns = document.querySelectorAll('.add-product-btn');
        addProductBtns.forEach(btn => {
            btn.style.display = AuthModule.isAdmin() ? 'block' : 'none';
        });
        
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
        
        if (productsResult.status === 'fulfilled') {
            products = productsResult.value;
        }
        
        if (salesResult.status === 'fulfilled') {
            sales = salesResult.value;
        } else {
            validateSalesData();
        }
        
        {
            const deletedSalesResult = await DataModule.fetchDeletedSales();
            if (deletedSalesResult) {
                deletedSales = deletedSalesResult;
            }
        }
        
        if (expenses.length === 0) {
            await DataModule.fetchExpenses();
        }
        

        if (purchases.length === 0) {
            await DataModule.fetchPurchases();
        }
        
        scheduleRender(() => checkAndGenerateAlerts());
        
        loadProducts();
        loadSales();
        setupRealtimeListeners();
        if (currentPage === 'reports') {
            try { generateReport(); } catch (_) {}
        }
        try {
            const d = new Date();
            if (d.getDay() === 4) {
                showPage('stock');
                showNotification('Thursday stock check is ready', 'info');
            }
        } catch (_) {}
    } catch (error) {
        console.error('Error loading initial data:', error);
        showNotification('Error loading data. Using offline cache.', 'warning');
        
        loadProducts();
        loadSales();
        setupRealtimeListeners();
        try { generateReport(); } catch (_) {}
    }
}

function showNotification(message, type = 'success') {
    notificationMessage.textContent = message;
    notification.className = `notification ${type} show`;
    
    const icon = notification.querySelector('i');
    icon.className = type === 'success' ? 'fas fa-check-circle' : 
                   type === 'error' ? 'fas fa-exclamation-circle' : 
                   type === 'warning' ? 'fas fa-exclamation-triangle' : 
                   'fas fa-info-circle';
    
    setTimeout(() => {
        notification.classList.remove('show');
    }, 3000);
}

function showInstallPromptNotification() {
    notificationMessage.textContent = 'Install this app';
    notification.className = 'notification info show';
    const icon = notification.querySelector('i');
    icon.className = 'fas fa-download';
    notification.onclick = async () => {
        try {
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
        } finally {
            notification.classList.remove('show');
            notification.onclick = null;
        }
    };
    setTimeout(() => {
        notification.classList.remove('show');
        notification.onclick = null;
    }, 10000);
}

function formatCurrency(amount) {
    return new Intl.NumberFormat('en-NG', { 
        style: 'currency', 
        currency: 'NGN',
        minimumFractionDigits: 2
    }).format(amount);
}

function formatDate(date, short = false) {
    if (!date) return '-';
    
    if (typeof date === 'string') {
        const d = new Date(date);
        
        if (isNaN(d.getTime())) {
            return '-';
        }
        
        if (short) {
            return d.toLocaleDateString();
        }
        
        return d.toLocaleDateString() + ' ' + d.toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'});
    }
    
    const d = date instanceof Date ? date : new Date(date);
    
    if (isNaN(d.getTime())) {
        return '-';
    }
    
    if (short) {
        return d.toLocaleDateString();
    }
    
    return d.toLocaleDateString() + ' ' + d.toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'});
}

function scheduleRender(fn) {
    if (typeof window !== 'undefined' && window.requestAnimationFrame) {
        window.requestAnimationFrame(fn);
    } else {
        setTimeout(fn, 0);
    }
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
    pageContents.forEach(page => {
        page.style.display = 'none';
    });
    
    const selectedPage = document.getElementById(`${pageName}-page`);
    if (selectedPage) {
        selectedPage.style.display = 'block';
    }
    
    navLinks.forEach(link => {
        link.classList.remove('active');
        if (link.getAttribute('data-page') === pageName) {
            link.classList.add('active');
        }
    });
    
    const titles = {
        'pos': 'Point of Sale',
        'inventory': 'Inventory Management',
        'reports': 'Sales Reports',
        'stock': 'Stock Check',
        'expenses': 'Expense Management',
        'purchases': 'Purchase Management',
        'analytics': 'Business Analytics',
        'account': 'My Account'
    };
    
    pageTitle.textContent = titles[pageName] || 'Pa Gerrys Mart';
    currentPage = pageName;
    
    if (pageName === 'inventory') {
        loadInventory();
    } else if (pageName === 'reports') {
        loadReports();
    } else if (pageName === 'stock') {
        loadStockCheck();
    } else if (pageName === 'account') {
        loadAccount();
    } else if (pageName === 'expenses') {
        loadExpenses();
    } else if (pageName === 'purchases') {
        loadPurchases();
    } else if (pageName === 'analytics') {
        loadAnalytics();
    }
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
        productsGrid.innerHTML = `
            <div class="empty-state">
                <i class="fas fa-box-open"></i>
                <h3>No Products Added Yet</h3>
                <p>Click "Add Product" to start adding your inventory</p>
            </div>
        `;
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
            if (product.stock <= 0) {
                stockClass = 'stock-low';
            } else if (product.stock <= settings.lowStockThreshold) {
                stockClass = 'stock-medium';
            }
            productCard.innerHTML = `
                <div class="product-img">
                    <i class="fas fa-box"></i>
                </div>
                <h4 ${productNameStyle}>${product.name}</h4>
                <div class="price">${formatCurrency(product.price)}</div>
                <div class="stock ${stockClass}">Stock: ${product.stock}</div>
                ${expiryWarning}
            `;
            productCard.addEventListener('click', () => addToCart(product));
            fragment.appendChild(productCard);
        }
        productsGrid.appendChild(fragment);
        if (index < list.length) {
            setTimeout(renderChunk, 0);
        }
    }
    renderChunk();
}

async function loadInventory() {
    const inventoryLoading = document.getElementById('inventory-loading');
    if (inventoryLoading) inventoryLoading.style.display = isOnline ? 'flex' : 'none';
    try {
        if (isOnline) {
            await DataModule.fetchAllProducts();
            if (inventoryLoading) inventoryLoading.style.display = 'none';
        }
    } catch (e) {
        if (inventoryLoading) inventoryLoading.style.display = 'none';
    }
    dedupeProducts();
    updateInventoryTotalFromAllProducts();
    const baseList = products.filter(p => !p.deleted);
    const msPerDay = 1000 * 60 * 60 * 24;
    const todayTs = Date.now();
    let list;
    if (!inventoryCategoryFilter) {
        list = baseList.slice();
    } else if (inventoryCategoryFilter === 'Expired') {
        list = baseList.filter(p => (Date.parse(p.expiryDate) - todayTs) / msPerDay < 0);
    } else if (inventoryCategoryFilter === 'Expiring Soon') {
        list = baseList.filter(p => {
            const d = Math.ceil((Date.parse(p.expiryDate) - todayTs) / msPerDay);
            return d >= 0 && d <= settings.expiryWarningDays;
        });
    } else if (inventoryCategoryFilter === 'Low Stock') {
        list = baseList.filter(p => p.stock > 0 && p.stock <= settings.lowStockThreshold);
    } else if (inventoryCategoryFilter === 'Out of Stock') {
        list = baseList.filter(p => p.stock <= 0);
    } else {
        list = baseList.filter(p => ((p.category || 'Uncategorized').toString() === inventoryCategoryFilter));
    }
    list = list.slice().sort((a, b) => {
        const an = (a.name || '').toString().toLowerCase();
        const bn = (b.name || '').toString().toLowerCase();
        return an.localeCompare(bn);
    });
    if (list.length === 0) {
        inventoryTableBody.innerHTML = `
            <tr>
                <td colspan="8" style="text-align: center;">No products in inventory</td>
            </tr>
        `;
        const inventoryTotalValue = document.getElementById('inventory-total-value');
        if (inventoryTotalValue) inventoryTotalValue.textContent = formatCurrency(0);
        const inventoryTotalItems = document.getElementById('inventory-total-items');
        if (inventoryTotalItems) inventoryTotalItems.textContent = '0';
        if (inventoryLoading) inventoryLoading.style.display = 'none';
        return;
    }
    let totalValue = list.reduce((sum, p) => sum + ((Number(p.price) || 0) * (Number(p.stock) || 0)), 0);
    const inventoryTotalItems = document.getElementById('inventory-total-items');
    if (inventoryTotalItems) inventoryTotalItems.textContent = String(list.length);
    const byCategory = {};
    const byCategoryCount = {};
    for (let i = 0; i < baseList.length; i++) {
        const p = baseList[i];
        const cat = (p.category || 'Uncategorized').toString();
        const val = ((Number(p.price) || 0) * (Number(p.stock) || 0));
        byCategory[cat] = (byCategory[cat] || 0) + val;
        byCategoryCount[cat] = (byCategoryCount[cat] || 0) + 1;
    }
    const summaryEl = document.getElementById('inventory-category-summary');
    if (summaryEl) {
        let sHtml = '';
        let expiredCount = 0, expiredValue = 0;
        let soonCount = 0, soonValue = 0;
        let lowCount = 0, lowValue = 0;
        let outCount = 0, outValue = 0;
        for (let i = 0; i < baseList.length; i++) {
            const p = baseList[i];
            const val = ((Number(p.price) || 0) * (Number(p.stock) || 0));
            const d = Math.ceil((Date.parse(p.expiryDate) - todayTs) / msPerDay);
            if (d < 0) { expiredCount++; expiredValue += val; }
            else if (d <= settings.expiryWarningDays) { soonCount++; soonValue += val; }
            if (p.stock <= 0) { outCount++; outValue += val; }
            else if (p.stock <= settings.lowStockThreshold) { lowCount++; lowValue += val; }
        }
        sHtml += `
            <div class="summary-card" onclick="filterInventoryByCategory('Expired')">
                <h3>Expired</h3>
                <p>${formatCurrency(expiredValue)}</p>
                <p>${expiredCount} items</p>
            </div>
            <div class="summary-card" onclick="filterInventoryByCategory('Expiring Soon')">
                <h3>Expiring Soon</h3>
                <p>${formatCurrency(soonValue)}</p>
                <p>${soonCount} items</p>
            </div>
            <div class="summary-card" onclick="filterInventoryByCategory('Low Stock')">
                <h3>Low Stock</h3>
                <p>${formatCurrency(lowValue)}</p>
                <p>${lowCount} items</p>
            </div>
            <div class="summary-card" onclick="filterInventoryByCategory('Out of Stock')">
                <h3>Out of Stock</h3>
                <p>${formatCurrency(outValue)}</p>
                <p>${outCount} items</p>
            </div>
        `;
        const cats = Object.keys(byCategory).sort((a,b) => a.localeCompare(b));
        for (let i = 0; i < cats.length; i++) {
            const c = cats[i];
            sHtml += `
                <div class="summary-card" onclick="filterInventoryByCategory('${c.replace(/'/g, "&#39;")}')">
                    <h3>${c}</h3>
                    <p>${formatCurrency(byCategory[c])}</p>
                    <p>${byCategoryCount[c]} items</p>
                </div>
            `;
        }
        summaryEl.innerHTML = sHtml;
    }
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
            const expiryTs = product.expiryTs || (product.expiryTs = Date.parse(product.expiryDate));
            const daysUntilExpiry = Math.ceil((expiryTs - todayTs) / msPerDay);
            let rowClass = '';
            let stockBadgeClass = 'stock-high';
            let stockBadgeText = 'In Stock';
            let productNameStyle = '';
            if (product.stock <= 0) {
                stockBadgeClass = 'stock-low';
                stockBadgeText = 'Out of Stock';
            } else if (product.stock <= settings.lowStockThreshold) {
                stockBadgeClass = 'stock-medium';
                stockBadgeText = 'Low Stock';
            }
            let expiryBadgeClass = 'expiry-good';
            let expiryBadgeText = 'Good';
            if (daysUntilExpiry < 0) {
                expiryBadgeClass = 'expiry-expired';
                expiryBadgeText = 'Expired';
                rowClass = 'expired';
                productNameStyle = 'style="color: red; font-weight: bold;"';
            } else if (daysUntilExpiry <= settings.expiryWarningDays) {
                expiryBadgeClass = 'expiry-warning';
                expiryBadgeText = 'Expiring Soon';
                rowClass = 'expiring-soon';
                productNameStyle = 'style="color: red; font-weight: bold;"';
            }
            let actionButtons = '';
            if (AuthModule.isAdmin()) {
                actionButtons = `
                    <div class="action-buttons">
                        <button class="btn-edit" onclick="editProduct('${product.id}')">
                            <i class="fas fa-edit"></i>
                        </button>
                        <button class="btn-delete" onclick="deleteProduct('${product.id}')">
                            <i class="fas fa-trash"></i>
                        </button>
                    </div>
                `;
            } else {
                actionButtons = '<span class="no-permission">Admin only</span>';
            }
            html += `
                <tr ${rowClass ? `class=\"${rowClass}\"` : ''}>
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
                    <td>
                        ${actionButtons}
                    </td>
                </tr>
            `;
        }
        if (mySeq !== inventoryRenderSeq) return;
        if (html) inventoryTableBody.insertAdjacentHTML('beforeend', html);
        if (index < list.length) {
            requestAnimationFrame(renderChunk);
        } else {
            const inventoryTotalValue = document.getElementById('inventory-total-value');
            if (inventoryTotalValue) inventoryTotalValue.textContent = formatCurrency(totalValue);
            if (inventoryLoading) inventoryLoading.style.display = 'none';
        }
    }
    requestAnimationFrame(renderChunk);
}

function filterInventoryByCategory(cat) {
    if (inventoryCategoryFilter === cat) {
        inventoryCategoryFilter = null;
    } else {
        inventoryCategoryFilter = cat;
    }
    loadInventory();
}

function loadSales() {
    updateSalesTables();
    
    if (currentPage === 'reports') {
        generateReport();
    }
}

function loadDeletedSales() {
    updateSalesTables();
}

function updateSalesTables() {
    const activeSales = sales.filter(s => !s.deleted && !s.deleted_at && !s.deletedAt);
    if (activeSales.length === 0) {
        salesTableBody.innerHTML = `
            <tr>
                <td colspan="5" style="text-align: center;">No sales data available</td>
            </tr>
        `;
    } else {
        salesTableBody.innerHTML = '';
        const sortedSales = [...activeSales].sort((a, b) => {
            const dateA = a.created_at ? new Date(a.created_at) : new Date(0);
            const dateB = b.created_at ? new Date(b.created_at) : new Date(0);
            return dateB - dateA;
        });
        const recentSales = sortedSales.slice(0, 10);
        const fragment = document.createDocumentFragment();
        recentSales.forEach(sale => {
            const row = document.createElement('tr');
            let actionButtons = `
                <button type="button" class="btn-edit" onclick="viewSale('${sale.id}')" title="View Sale">
                    <i class="fas fa-eye"></i>
                </button>
            `;
            if (AuthModule.isAdmin()) {
                actionButtons += `
                    <button type="button" class="btn-delete" onclick="deleteSale('${sale.id}')" title="Delete Sale">
                        <i class="fas fa-trash"></i>
                    </button>
                `;
            }
            const totalItemsSold = sale.items.reduce((sum, item) => sum + item.quantity, 0);
            row.innerHTML = `
                <td>${sale.receiptNumber}</td>
                <td>${formatDate(sale.created_at)}</td>
                <td>${totalItemsSold}</td>
                <td>${formatCurrency(sale.total)}</td>
                <td>
                    <div class="action-buttons">
                        ${actionButtons}
                    </div>
                </td>
            `;
            fragment.appendChild(row);
        });
        salesTableBody.appendChild(fragment);
    }
    
    if (deletedSales.length === 0) {
        deletedSalesTableBody.innerHTML = `
            <tr>
                <td colspan="5" style="text-align: center;">No deleted sales</td>
            </tr>
        `;
    } else {
        deletedSalesTableBody.innerHTML = '';
        const sortedDeletedSales = [...deletedSales].sort((a, b) => {
            const aDel = a.deleted_at || a.deletedAt;
            const bDel = b.deleted_at || b.deletedAt;
            const dateA = aDel ? new Date(aDel) : new Date(0);
            const dateB = bDel ? new Date(bDel) : new Date(0);
            return dateB - dateA;
        });
        const fragmentDeleted = document.createDocumentFragment();
        sortedDeletedSales.forEach(sale => {
            const row = document.createElement('tr');
            const totalItemsSold = sale.items.reduce((sum, item) => sum + item.quantity, 0);
            row.innerHTML = `
                <td>${sale.receiptNumber}</td>
                <td>${formatDate(sale.created_at)}</td>
                <td>${totalItemsSold}</td>
                <td>${formatCurrency(sale.total)}</td>
                <td><span class="deleted-badge">Deleted</span></td>
            `;
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
    if (reportDateEl) {
        reportDateEl.value = today;
    }
    const periodEl = document.getElementById('report-period');
    const startEl = document.getElementById('report-start-date');
    const endEl = document.getElementById('report-end-date');
    const debouncedGenerateReport = debounce(() => generateReport(), 150);
    if (periodEl) {
        periodEl.addEventListener('change', () => {
            const v = periodEl.value || 'day';
            const showRange = v === 'custom';
            if (startEl) startEl.style.display = showRange ? '' : 'none';
            if (endEl) endEl.style.display = showRange ? '' : 'none';
            debouncedGenerateReport();
        });
    }
    if (reportDateEl) {
        reportDateEl.addEventListener('change', debouncedGenerateReport);
    }
    if (startEl) startEl.addEventListener('change', debouncedGenerateReport);
    if (endEl) endEl.addEventListener('change', debouncedGenerateReport);
    const generateBtn = document.getElementById('generate-report-btn');
    if (generateBtn) {
        generateBtn.onclick = debouncedGenerateReport;
    }
    const productSearchEl = document.getElementById('report-product-search');
    if (productSearchEl) {
        productSearchEl.addEventListener('input', () => {
            renderProductSalesTable(currentProductSalesRows, productSearchEl.value);
        });
    }
    const categorySearchEl = document.getElementById('report-category-search');
    if (categorySearchEl) {
        categorySearchEl.addEventListener('input', () => {
            renderCategorySalesTable(currentCategorySalesRows, categorySearchEl.value);
        });
    }
    
    setTimeout(() => {
        if (reportsLoading) reportsLoading.style.display = 'none';
        
        if (sales.length === 0) {
            isReportsLoading = true;
            DataModule.fetchSales().then(fetchedSales => {
                sales = fetchedSales;
                isReportsLoading = false;
                debouncedGenerateReport();
            }).catch(error => {
                console.error('Error fetching sales for report:', error);
                isReportsLoading = false;
                debouncedGenerateReport();
            });
        } else {
            debouncedGenerateReport();
        }
    }, 0);
}

function generateReport() {
    try {
        if (isReportsLoading) return;
        const reportDateEl = document.getElementById('report-date');
        const selectedDate = reportDateEl ? reportDateEl.value : new Date().toISOString().split('T')[0];
        let selectedDateObj = null;
        if (selectedDate && typeof selectedDate === 'string') {
            const parts = selectedDate.split('-').map(Number);
            if (parts.length === 3 && !parts.some(isNaN)) {
                selectedDateObj = new Date(parts[0], parts[1] - 1, parts[2]);
            }
        }
        if (!selectedDateObj) {
            const now = new Date();
            selectedDateObj = new Date(now.getFullYear(), now.getMonth(), now.getDate());
        }
        
        const activeSales = Array.isArray(sales) ? sales.filter(s => !s.deleted && !s.deleted_at && !s.deletedAt) : [];
        const archivedSales = Array.isArray(deletedSales) ? deletedSales : [];

        const combinedMap = new Map();
        for (const s of [...activeSales, ...archivedSales]) {
            if (!s || typeof s !== 'object') continue;
            const rn = s.receiptnumber || s.receiptNumber || `NO_RN_${s.id || Math.random()}`;
            if (!combinedMap.has(rn)) combinedMap.set(rn, s);
        }
        const combinedSales = Array.from(combinedMap.values());

        let totalSales = 0;
        let totalTransactions = 0;
        let totalItemsSold = 0;
        let totalCash = 0;
        let totalPos = 0;
        
        activeSales.forEach(sale => {
            if (!sale || typeof sale !== 'object') return;
            totalSales += (typeof sale.total === 'number') ? sale.total : parseFloat(sale.total) || 0;
            totalTransactions++;
            if (Array.isArray(s
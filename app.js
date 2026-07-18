    let supabaseClient = null;
    let productsRealtimeChannel = null;
    let productsReloadTimer = null;
    let localProducts = [];
    let localCategories = [];
    let activeCategory = 'all';
    
    const SUPABASE_URL_KEY = 'zort_ws_supabase_url';
    const SUPABASE_ANON_KEY = 'zort_ws_supabase_anon_key';
    const DEFAULT_SUPABASE_URL = 'https://rqyxvhvyrmclklittcoe.supabase.co';
    const DEFAULT_SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InJxeXh2aHZ5cm1jbGtsaXR0Y29lIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODI5OTQ5NjEsImV4cCI6MjA5ODU3MDk2MX0.9qSo5WGHPrY9iQAIaPz1C_MySTR1hVa4SZLoPQLiu4M';
    let localStorageAvailable = null;

    function safeStorageAvailable() {
      if (localStorageAvailable !== null) return localStorageAvailable;
      try {
        const testKey = '__zort_storage_test__';
        window.localStorage.setItem(testKey, testKey);
        window.localStorage.removeItem(testKey);
        localStorageAvailable = true;
      } catch (err) {
        console.warn('Local storage is unavailable:', err);
        localStorageAvailable = false;
      }
      return localStorageAvailable;
    }

    function getStoredItem(key) {
      if (!safeStorageAvailable()) return null;
      try {
        return window.localStorage.getItem(key);
      } catch (err) {
        console.warn('Failed to read localStorage key:', key, err);
        return null;
      }
    }

    function setStoredItem(key, value) {
      if (!safeStorageAvailable()) return;
      try {
        window.localStorage.setItem(key, value);
      } catch (err) {
        console.warn('Failed to write localStorage key:', key, err);
      }
    }

    function removeStoredItem(key) {
      if (!safeStorageAvailable()) return;
      try {
        window.localStorage.removeItem(key);
      } catch (err) {
        console.warn('Failed to remove localStorage key:', key, err);
      }
    }

    function safeParseJson(value, fallback) {
      if (value === null || value === undefined || value === '') return fallback;
      if (typeof value !== 'string') return value;
      try {
        return JSON.parse(value);
      } catch (error) {
        console.warn('Invalid JSON ignored:', error);
        return fallback;
      }
    }

    function getProductCategories(prod) {
      const categories = safeParseJson(prod?.categories, []);
      return Array.isArray(categories) ? categories : [];
    }

    function getCategoryName(category) {
      if (!category) return '';
      if (typeof category === 'string') return category.trim();
      if (typeof category !== 'object') return '';
      return safeText(
        category.name ??
        category.slug ??
        category.label ??
        category.title ??
        category.category
      ).trim();
    }

    function normalizeProductCategories(prod) {
      return getProductCategories(prod)
        .map(category => ({ ...category, name: getCategoryName(category) }))
        .filter(category => category.name);
    }

    function getProductImages(prod) {
      const images = safeParseJson(prod?.images, []);
      return Array.isArray(images) ? images : [];
    }

    function safeText(value, fallback = '') {
      return typeof value === 'string' ? value : (value ?? fallback);
    }

    function ensureDefaultSupabaseConfig() {
      if (!getStoredItem(SUPABASE_URL_KEY)) {
        setStoredItem(SUPABASE_URL_KEY, DEFAULT_SUPABASE_URL);
      }
      if (!getStoredItem(SUPABASE_ANON_KEY)) {
        setStoredItem(SUPABASE_ANON_KEY, DEFAULT_SUPABASE_ANON_KEY);
      }
    }

    function initTheme() {
      const themeValue = getStoredItem('theme');
      const isDark = themeValue === 'dark' || 
                    (themeValue === null && window.matchMedia('(prefers-color-scheme: dark)').matches);
      if (isDark) {
        document.documentElement.classList.add('dark');
      } else {
        document.documentElement.classList.remove('dark');
      }
    }

    function toggleTheme() {
      if (document.documentElement.classList.contains('dark')) {
        document.documentElement.classList.remove('dark');
        setStoredItem('theme', 'light');
      } else {
        document.documentElement.classList.add('dark');
        setStoredItem('theme', 'dark');
      }
    }

    function openConfigModal() {
      document.getElementById('db-url').value = getStoredItem(SUPABASE_URL_KEY) || DEFAULT_SUPABASE_URL;
      document.getElementById('db-key').value = getStoredItem(SUPABASE_ANON_KEY) || DEFAULT_SUPABASE_ANON_KEY;
      document.getElementById('config-modal').classList.remove('hidden');
    }

    function closeConfigModal() {
      document.getElementById('config-modal').classList.add('hidden');
    }

    function saveConfig() {
      const url = document.getElementById('db-url').value.trim();
      const key = document.getElementById('db-key').value.trim();
      if (url && key) {
        setStoredItem(SUPABASE_URL_KEY, url);
        setStoredItem(SUPABASE_ANON_KEY, key);
        closeConfigModal();
        initSupabase();
        loadProducts();
      } else {
        alert('กรุณากรอกข้อมูลเชื่อมต่อให้ครบถ้วน');
      }
    }

    function cleanupRealtimeSubscription() {
      if (productsRealtimeChannel && supabaseClient) {
        supabaseClient.removeChannel(productsRealtimeChannel);
      }
      productsRealtimeChannel = null;
    }

    function scheduleRealtimeReload(reason) {
      clearTimeout(productsReloadTimer);
      productsReloadTimer = setTimeout(() => {
        console.log('Realtime products refresh triggered:', reason);
        loadProducts();
      }, 300);
    }

    function subscribeProductsRealtime() {
      if (!supabaseClient) return;
      cleanupRealtimeSubscription();
      productsRealtimeChannel = supabaseClient
        .channel('storefront-products-realtime')
        .on('postgres_changes', { event: '*', schema: 'public', table: 'products' }, payload => {
          console.log('Products realtime payload:', payload);
          scheduleRealtimeReload(payload.eventType || 'unknown');
        })
        .subscribe((status) => { console.log('Products realtime status:', status); });
    }

    function initSupabase() {
      ensureDefaultSupabaseConfig();
      const url = getStoredItem(SUPABASE_URL_KEY);
      const key = getStoredItem(SUPABASE_ANON_KEY);
      const indicator = document.getElementById('sync-indicator');
      cleanupRealtimeSubscription();

      if (url && key && window.supabase) {
        try {
          supabaseClient = window.supabase.createClient(url, key);
          subscribeProductsRealtime();
          if (indicator) {
            indicator.innerHTML = '<span class="w-2 h-2 rounded-full bg-emerald-400 inline-block animate-ping"></span> เชื่อมต่อสำเร็จ';
            indicator.className = 'font-bold flex items-center gap-2 text-emerald-400';
          }
          console.log('Supabase initialized in Storefront.');
          return true;
        } catch (error) {
          console.error('Failed to init Supabase:', error);
        }
      }
      if (indicator) {
        indicator.innerHTML = '<span class="w-2 h-2 rounded-full bg-amber-400 inline-block"></span> รอการตั้งค่า';
        indicator.className = 'font-bold flex items-center gap-2 text-amber-400';
      } else {
        console.warn('sync-indicator element not found in DOM.');
      }
      supabaseClient = null;
      return false;
    }

    async function loadProducts() {
      const spinner = document.getElementById('loading-spinner');
      const grid = document.getElementById('products-grid');
      const empty = document.getElementById('empty-state');
      const emptyDesc = document.getElementById('empty-state-desc');

      if (!spinner || !grid || !empty || !emptyDesc) {
        console.error('Catalog UI is missing required elements.', {
          spinner: !!spinner,
          grid: !!grid,
          empty: !!empty,
          emptyDesc: !!emptyDesc
        });
        return;
      }
      
      spinner.classList.remove('hidden');
      grid.classList.add('hidden');
      empty.classList.add('hidden');

      if (!supabaseClient) {
        spinner.classList.add('hidden');
        empty.classList.remove('hidden');
        document.getElementById('empty-state-desc').innerHTML = 'กรุณากรอก Supabase URL และ Key เพื่อดึงรายการหนังสือจากฐานข้อมูล';
        return;
      }

      try {
        const [{ data, error }, categoriesResult] = await Promise.all([
          supabaseClient
            .from('products')
            .select('*')
            .order('id', { ascending: false }),
          loadCategoriesFromSupabase()
        ]);

        if (error) throw error;

        localProducts = data || [];
        localCategories = categoriesResult;
        spinner.classList.add('hidden');
        
        if (localProducts.length === 0) {
          empty.classList.remove('hidden');
          document.getElementById('empty-state-desc').innerHTML = 'ยังไม่พบหนังสือในระบบ กรุณาซิงก์ข้อมูลจาก ZORT';
        } else {
          grid.classList.remove('hidden');
          renderCategories();
          filterProducts();
        }
      } catch (err) {
        console.error('Error fetching catalog products:', err);
        spinner.classList.add('hidden');
        empty.classList.remove('hidden');
        document.getElementById('empty-state-desc').innerHTML = 'ไม่สามารถดึงข้อมูลหนังสือได้: ' + err.message;
      }
    }

    async function loadCategoriesFromSupabase() {
      if (!supabaseClient) return [];

      try {
        const { data, error } = await supabaseClient
          .from('products')
          .select('categories')
          .not('categories', 'is', null);

        if (error) throw error;

        const categoriesMap = {};
        (data || []).forEach(row => {
          const categories = normalizeProductCategories(row);
          categories.forEach(category => {
            categoriesMap[category.name] = (categoriesMap[category.name] || 0) + 1;
          });
        });

        return Object.keys(categoriesMap)
          .sort((a, b) => a.localeCompare(b, 'th'))
          .map(name => ({ name, count: categoriesMap[name] }));
      } catch (error) {
        console.error('Error loading categories from Supabase:', error);
        return [];
      }
    }

    function renderCategories() {
      const catsEl = document.getElementById('category-filter-list');
      catsEl.innerHTML = `
        <button onclick="selectCategory('all')" class="text-left py-2 px-3 text-sm font-semibold rounded-lg w-full transition flex items-center justify-between ${activeCategory === 'all' ? 'bg-primary/10 text-primary' : 'hover:bg-stone-100 dark:hover:bg-zinc-700'}" id="cat-btn-all">
          <span>ทั้งหมด</span>
          <span class="text-xs bg-stone-200 dark:bg-zinc-900 font-bold px-2 py-0.5 rounded-md text-stone-600 dark:text-stone-300" id="cat-count-all">${localProducts.length}</span>
        </button>
      `;

      localCategories.forEach(category => {
        const catName = category.name;
        const count = category.count;
        const isSelected = activeCategory === catName;
        catsEl.innerHTML += `
          <button onclick="selectCategory('${catName}')" class="text-left py-2 px-3 text-sm font-semibold rounded-lg w-full transition flex items-center justify-between ${isSelected ? 'bg-primary/10 text-primary' : 'hover:bg-stone-100 dark:hover:bg-zinc-700'}" id="cat-btn-${catName}">
            <span class="truncate pr-2">${catName}</span>
            <span class="text-xs bg-stone-200 dark:bg-zinc-900 font-bold px-2 py-0.5 rounded-md text-stone-600 dark:text-stone-300">${count}</span>
          </button>
        `;
      });
    }

    function selectCategory(category) {
      activeCategory = category;
      renderCategories();
      filterProducts();
    }

    function filterProducts() {
      const search = document.getElementById('search-input').value.toLowerCase().trim();
      const showInStock = document.getElementById('filter-instock').checked;
      const showOutOfStock = document.getElementById('filter-outofstock').checked;
      const minPriceValue = document.getElementById('filter-min-price').value;
      const maxPriceValue = document.getElementById('filter-max-price').value;
      const minPrice = minPriceValue === '' ? 0 : Number(minPriceValue);
      const maxPrice = maxPriceValue === '' ? Number.POSITIVE_INFINITY : Number(maxPriceValue);
      
      const filtered = localProducts.filter(prod => {
        const productName = safeText(prod.name).toLowerCase();
        const productSku = safeText(prod.sku).toLowerCase();
        const matchSearch = productName.includes(search) || productSku.includes(search);
        let matchCategory = activeCategory === 'all';
        if (!matchCategory) {
          const cats = normalizeProductCategories(prod);
          matchCategory = cats.some(c => c.name === activeCategory);
        }
        const isInstock = prod.stock_status === 'instock';
        let matchStock = false;
        if (showInStock && isInstock) matchStock = true;
        if (showOutOfStock && !isInstock) matchStock = true;
        const productPrice = Number(prod.price) || 0;
        const matchPrice = productPrice >= minPrice && productPrice <= maxPrice;
        return matchSearch && matchCategory && matchStock && matchPrice;
      });

      renderProducts(filtered);
    }

    function renderProducts(productsList) {
      const grid = document.getElementById('products-grid');
      const empty = document.getElementById('empty-state');
      const emptyDesc = document.getElementById('empty-state-desc');
      const productCountDisplay = document.getElementById('product-count-display');

      if (!grid || !empty || !emptyDesc || !productCountDisplay) {
        console.error('Catalog render skipped because required elements are missing.', {
          grid: !!grid,
          empty: !!empty,
          emptyDesc: !!emptyDesc,
          productCountDisplay: !!productCountDisplay
        });
        return;
      }

      productCountDisplay.innerText = productsList.length;

      if (productsList.length === 0) {
        grid.classList.add('hidden');
        empty.classList.remove('hidden');
        document.getElementById('empty-state-desc').innerText = 'ไม่พบหนังสือที่ตรงกับเงื่อนไข';
        return;
      }

      empty.classList.add('hidden');
      grid.classList.remove('hidden');
      grid.innerHTML = '';

      productsList.forEach(prod => {
        const isInstock = prod.stock_status === 'instock';
        const price = prod.price ? parseFloat(prod.price).toLocaleString() : 'ติดต่อผู้ขาย';
        const imgs = getProductImages(prod);
        const coverSrc = imgs.length > 0 && imgs[0].src ? imgs[0].src : 'https://images.unsplash.com/photo-1512820790803-83ca734da794?auto=format&fit=crop&q=80&w=400';
        const productName = safeText(prod.name, 'Untitled book');
        const productSku = safeText(prod.sku);
        const productSummary = safeText(prod.short_description || prod.description || 'ยังไม่มีคำโปรยสำหรับหนังสือเล่มนี้');

        const stockBadge = isInstock
          ? `<span class="badge-ok"><i class="fas fa-circle-check text-[9px]"></i> พร้อมส่ง ${prod.stock_quantity ?? 0}</span>`
          : `<span class="badge-no"><i class="fas fa-circle-xmark text-[9px]"></i> หมดชั่วคราว</span>`;

        const card = `
          <div onclick="openProductModal(${prod.id})" class="book-card group">
            <div class="card-img">
              <img src="${coverSrc}" alt="${productName}" loading="lazy">
              ${productSku ? `<span class="absolute top-2 left-2 text-[9px] bg-black/60 text-white font-bold px-2 py-1 rounded-lg backdrop-blur-sm">${productSku}</span>` : ''}
            </div>
            <div class="p-4 flex flex-col flex-1">
              <div class="flex items-start justify-between gap-2 mb-1">
                <h4 class="font-bold text-stone-900 dark:text-white line-clamp-2 text-sm leading-snug group-hover:text-primary transition">${productName}</h4>
                ${stockBadge}
              </div>
              <p class="text-xs text-stone-400 line-clamp-2 mt-1 flex-1">${productSummary}</p>
              <div class="flex items-center justify-between mt-4 pt-3 border-t border-stone-100 dark:border-stone-700">
                <div class="flex items-baseline gap-1">
                  <span class="text-xs text-stone-400">฿</span>
                  <span class="text-lg font-black text-primary dark:text-amber-400">${price}</span>
                </div>
                <button onclick="event.stopPropagation(); addToCart(${prod.id}, 1)" class="btn-add" ${!isInstock ? 'disabled' : ''}>
                  <i class="fas fa-cart-plus text-[10px]"></i> หยิบใส่
                </button>
              </div>
            </div>
          </div>
        `;
        grid.innerHTML += card;
      });
    }

    function openProductModal(productId) {
      const prod = localProducts.find(p => p.id === productId);
      if (!prod) return;

      const modal = document.getElementById('product-detail-modal');
      document.getElementById('modal-title').innerText = safeText(prod.name, 'Untitled book');
      document.getElementById('modal-sku').innerText = safeText(prod.sku, 'N/A');
      document.getElementById('modal-price').innerText = prod.price ? parseFloat(prod.price).toLocaleString() : 'สอบถามราคา';
      document.getElementById('modal-desc').innerHTML = safeText(prod.description).replace(/\n/g, '<br>') || 'ยังไม่มีรายละเอียดเพิ่มเติม';
      document.getElementById('modal-stock-qty').innerText = (prod.stock_quantity !== null && prod.stock_quantity !== undefined) ? `${prod.stock_quantity} เล่ม` : 'ไม่ได้ระบุจำนวน';

      const manageStockEl = document.getElementById('modal-manage-stock');
      if (prod.manage_stock) {
        manageStockEl.innerText = 'ซิงก์สต็อกอัตโนมัติ';
        manageStockEl.className = 'text-xs font-bold text-emerald-500';
      } else {
        manageStockEl.innerText = 'ไม่ได้เปิดคุมสต็อก';
        manageStockEl.className = 'text-xs font-bold text-stone-400';
      }

      const isInstock = prod.stock_status === 'instock';
      const badge = document.getElementById('modal-stock-badge');
      if (isInstock) {
        badge.innerText = 'พร้อมจัดส่ง (IN STOCK)';
        badge.className = 'px-2.5 py-0.5 text-[9px] font-bold rounded-lg bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-400';
      } else {
        badge.innerText = 'หมดชั่วคราว (OUT OF STOCK)';
        badge.className = 'px-2.5 py-0.5 text-[9px] font-bold rounded-lg bg-stone-100 text-stone-500 dark:bg-stone-800 dark:text-stone-400';
      }

      const imgs = getProductImages(prod);
      const mainImg = document.getElementById('modal-img-main');
      const thumbs = document.getElementById('modal-img-thumbs');
      thumbs.innerHTML = '';

      if (imgs.length > 0) {
        mainImg.src = imgs[0].src;
        imgs.forEach((img, idx) => {
          const isSelectedClass = idx === 0 ? 'border-2 border-primary' : 'border opacity-60 hover:opacity-100';
          thumbs.innerHTML += `
            <div onclick="setMainImage('${String(img.src || '').replace(/'/g, "\\'")}', this)" class="aspect-square bg-stone-50 dark:bg-zinc-900 rounded-lg overflow-hidden cursor-pointer border transition ${isSelectedClass}">
              <img src="${img.src}" class="w-full h-full object-cover">
            </div>
          `;
        });
      } else {
        mainImg.src = 'https://images.unsplash.com/photo-1512820790803-83ca734da794?auto=format&fit=crop&q=80&w=400';
      }

      const hasLength = prod.length !== null && prod.length !== undefined && prod.length !== '';
      const hasWidth = prod.width !== null && prod.width !== undefined && prod.width !== '';
      const hasHeight = prod.height !== null && prod.height !== undefined && prod.height !== '';
      const dimContainer = document.getElementById('modal-dimensions-container');

      if (hasLength || hasWidth || hasHeight) {
        dimContainer.classList.remove('hidden');
        document.getElementById('modal-len').innerText = hasLength ? `${prod.length} ซม.` : '-';
        document.getElementById('modal-width').innerText = hasWidth ? `${prod.width} ซม.` : '-';
        document.getElementById('modal-height').innerText = hasHeight ? `${prod.height} ซม.` : '-';
      } else {
        dimContainer.classList.add('hidden');
      }

      modal.classList.remove('hidden');
    }

    function setMainImage(src, thumbElement) {
      document.getElementById('modal-img-main').src = src;
      const siblingDivs = thumbElement.parentElement.children;
      for (let div of siblingDivs) {
        div.className = div.className.replace('border-2 border-primary', 'border opacity-60').replace('opacity-100', '');
      }
      thumbElement.className = thumbElement.className.replace('border opacity-60', 'border-2 border-primary opacity-100');
    }

    function closeProductModal() {
      document.getElementById('product-detail-modal').classList.add('hidden');
    }

    function normalizeMoney(value) {
      if (typeof value === 'number') return Number.isFinite(value) ? value : 0;
      if (typeof value === 'string') {
        const cleaned = value.replace(/,/g, '').trim();
        const parsed = parseFloat(cleaned);
        return Number.isFinite(parsed) ? parsed : 0;
      }
      return 0;
    }

const initialCart = safeParseJson(getStoredItem('shop_cart'), []);
    let cart = (Array.isArray(initialCart) ? initialCart : []).map(item => ({
      ...item,
      price: normalizeMoney(item.price),
      qty: Math.max(1, parseInt(item.qty, 10) || 1)
    }));
    let currentModalProductId = null;
    
    function saveCart() { setStoredItem('shop_cart', JSON.stringify(cart)); }

    function updateCartBadge() {
      const total = cart.reduce((s, i) => s + i.qty, 0);
      const badge = document.getElementById('cart-badge');
      badge.textContent = total;
      badge.classList.toggle('hidden', total === 0);
    }

    function cartTotal() {
      return cart.reduce((s, i) => s + normalizeMoney(i.price) * (parseInt(i.qty, 10) || 0), 0);
    }

    function getProductStockLimit(prod) {
      if (!prod) return Number.POSITIVE_INFINITY;
      if (prod.manage_stock && prod.stock_quantity !== null && prod.stock_quantity !== undefined && prod.stock_quantity !== '') {
        const qty = Number(prod.stock_quantity);
        return Number.isFinite(qty) ? Math.max(0, qty) : 0;
      }
      if (prod.stock_status && prod.stock_status !== 'instock') return 0;
      return Number.POSITIVE_INFINITY;
    }

    function addToCart(productId, qty) {
      const prod = localProducts.find(p => p.id === productId);
      if (!prod) return;
      const stockLimit = getProductStockLimit(prod);
      if (stockLimit <= 0) { showToast(`"${prod.name}" หมดชั่วคราว`); return; }
      const requestedQty = Math.max(1, parseInt(qty, 10) || 1);
      const price = normalizeMoney(prod.price ?? prod.regular_price ?? prod.sale_price);
      const existing = cart.find(i => i.productId === productId);
      const currentQty = existing ? existing.qty : 0;
      const nextQty = Math.min(stockLimit, currentQty + requestedQty);
      if (existing && currentQty >= stockLimit) {
        showToast(`เพิ่ม "${prod.name}" ได้สูงสุด ${stockLimit} ชิ้นตามสต็อก`);
        return;
      }
      if (existing) {
        existing.qty = nextQty;
        existing.price = price;
      } else {
        cart.push({ productId, name: prod.name, sku: prod.sku || '', price, qty: nextQty });
      }
      saveCart();
      updateCartBadge();
      if (requestedQty > stockLimit || nextQty < currentQty + requestedQty) {
        showToast(`เพิ่ม "${prod.name}" ได้สูงสุด ${stockLimit} ชิ้น`);
      } else {
        showToast(`เพิ่ม "${prod.name}" ลงตะกร้าแล้ว`);
      }
    }

    function addToCartFromModal() {
      const qty = parseInt(document.getElementById('modal-qty').value) || 1;
      if (currentModalProductId) addToCart(currentModalProductId, qty);
      closeProductModal();
    }

    function changeModalQty(delta) {
      const input = document.getElementById('modal-qty');
      const currentQty = parseInt(input.value, 10) || 1;
      const prod = localProducts.find(p => p.id === currentModalProductId);
      const stockLimit = getProductStockLimit(prod);
      const nextQty = Math.max(1, currentQty + delta);
      if (stockLimit !== Number.POSITIVE_INFINITY) {
        input.value = Math.min(stockLimit, nextQty);
        if (delta > 0 && currentQty >= stockLimit) showToast(`เลือกได้สูงสุด ${stockLimit} ชิ้น`);
        return;
      }
      input.value = nextQty;
    }

    function validateModalQty() {
      const input = document.getElementById('modal-qty');
      const prod = localProducts.find(p => p.id === currentModalProductId);
      const stockLimit = getProductStockLimit(prod);
      let value = parseInt(input.value, 10) || 1;
      value = Math.max(1, value);
      if (stockLimit !== Number.POSITIVE_INFINITY) value = Math.min(stockLimit || 1, value);
      input.value = value;
    }

    function openCartDrawer() {
      renderCartItems();
      document.getElementById('cart-drawer').style.transform = 'translateX(0)';
      document.getElementById('cart-overlay').classList.remove('hidden');
    }

    function closeCartDrawer() {
      document.getElementById('cart-drawer').style.transform = 'translateX(100%)';
      document.getElementById('cart-overlay').classList.add('hidden');
    }

    function renderCartItems() {
      const list = document.getElementById('cart-items-list');
      if (cart.length === 0) {
        list.innerHTML = '<div class="py-16 text-center text-stone-400"><i class="fas fa-shopping-bag text-4xl mb-3 block opacity-20"></i><p class="text-sm">ยังไม่มีหนังสือในตะกร้า</p></div>';
      } else {
        list.innerHTML = cart.map((item, idx) => `
          <div class="flex items-start gap-3 bg-stone-50 dark:bg-stone-800/50 rounded-xl p-3">
            <div class="flex-1 min-w-0">
              <p class="font-bold text-sm text-stone-800 dark:text-white truncate">${item.name}</p>
              ${item.sku ? `<p class="text-[10px] text-stone-400">SKU: ${item.sku}</p>` : ''}
              <p class="text-primary dark:text-amber-400 font-bold text-sm mt-0.5">฿${(item.price * item.qty).toLocaleString()}</p>
            </div>
            <div class="flex items-center border border-stone-200 dark:border-stone-600 rounded-lg overflow-hidden shrink-0">
              <button onclick="changeCartQty(${idx}, -1)" class="w-7 h-7 flex items-center justify-center text-stone-500 hover:bg-stone-200 dark:hover:bg-stone-700 font-bold transition">−</button>
              <span class="w-7 text-center text-xs font-bold text-stone-800 dark:text-white">${item.qty}</span>
              <button onclick="changeCartQty(${idx}, 1)" class="w-7 h-7 flex items-center justify-center text-stone-500 hover:bg-stone-200 dark:hover:bg-stone-700 font-bold transition">+</button>
            </div>
            <button onclick="removeFromCart(${idx})" class="text-red-400 hover:text-red-600 transition text-sm mt-0.5"><i class="fas fa-trash"></i></button>
          </div>
        `).join('');
      }
      document.getElementById('cart-total-display').textContent = '฿' + cartTotal().toLocaleString();
    }

    function changeCartQty(idx, delta) {
      const item = cart[idx];
      if (!item) return;
      const prod = localProducts.find(p => p.id === item.productId);
      const stockLimit = getProductStockLimit(prod);
      const nextQty = Math.max(1, item.qty + delta);
      if (delta > 0 && stockLimit !== Number.POSITIVE_INFINITY) {
        if (item.qty >= stockLimit) { showToast(`เพิ่ม "${item.name}" ได้สูงสุด ${stockLimit} ชิ้น`); return; }
        item.qty = Math.min(stockLimit, nextQty);
      } else {
        item.qty = nextQty;
      }
      saveCart(); updateCartBadge(); renderCartItems();
    }

    function removeFromCart(idx) {
      cart.splice(idx, 1);
      saveCart(); updateCartBadge(); renderCartItems();
    }

    const PAYMENT_SLIP_MAX_BYTES = 5 * 1024 * 1024;
    const PAYMENT_SLIP_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp']);
    let selectedPaymentSlip = null;

    function clearPaymentSlip() {
      selectedPaymentSlip = null;
      const input = document.getElementById('co-payment-slip');
      const preview = document.getElementById('co-payment-slip-preview');
      const image = document.getElementById('co-payment-slip-image');
      if (input) input.value = '';
      if (image?.src?.startsWith('blob:')) URL.revokeObjectURL(image.src);
      if (image) image.removeAttribute('src');
      preview?.classList.add('hidden');
      preview?.classList.remove('flex');
    }

    function handlePaymentSlipChange(event) {
      const file = event.target.files?.[0] || null;
      const errEl = document.getElementById('co-error');
      if (!file) { clearPaymentSlip(); return; }
      if (!PAYMENT_SLIP_TYPES.has(file.type)) {
        clearPaymentSlip();
        errEl.textContent = 'กรุณาแนบสลิปชนิด JPG, PNG หรือ WebP เท่านั้น';
        errEl.classList.remove('hidden'); return;
      }
      if (file.size > PAYMENT_SLIP_MAX_BYTES) {
        clearPaymentSlip();
        errEl.textContent = 'ไฟล์สลิปต้องมีขนาดไม่เกิน 5 MB';
        errEl.classList.remove('hidden'); return;
      }
      selectedPaymentSlip = file;
      const image = document.getElementById('co-payment-slip-image');
      if (image?.src?.startsWith('blob:')) URL.revokeObjectURL(image.src);
      image.src = URL.createObjectURL(file);
      document.getElementById('co-payment-slip-name').textContent = file.name;
      document.getElementById('co-payment-slip-size').textContent = `${(file.size / 1024).toFixed(1)} KB`;
      const preview = document.getElementById('co-payment-slip-preview');
      preview.classList.remove('hidden');
      preview.classList.add('flex');
      errEl.classList.add('hidden');
    }

    function paymentSlipToBase64(file) {
      return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result).split(',')[1] || '');
        reader.onerror = () => reject(new Error('ไม่สามารถอ่านไฟล์สลิปได้'));
        reader.readAsDataURL(file);
      });
    }

    function openCheckout() {
      if (cart.length === 0) return;
      closeCartDrawer();
      document.getElementById('co-summary-items').innerHTML = cart.map(i => `
        <div class="flex justify-between text-xs">
          <span class="text-stone-600 dark:text-stone-400 truncate pr-2">${i.name} x${i.qty}</span>
          <span class="font-semibold shrink-0">฿${(i.price * i.qty).toLocaleString()}</span>
        </div>
      `).join('');
      document.getElementById('co-total-display').textContent = '฿' + cartTotal().toLocaleString();
      document.getElementById('co-promptpay-total').textContent = '฿' + cartTotal().toLocaleString();
      updateCheckoutPaymentUI();
      document.getElementById('checkout-form-section').classList.remove('hidden');
      document.getElementById('checkout-success-section').classList.add('hidden');
      document.getElementById('co-error').classList.add('hidden');
      document.getElementById('checkout-modal').classList.remove('hidden');
    }

    function closeCheckout() {
      document.getElementById('checkout-modal').classList.add('hidden');
    }

    function getSelectedCheckoutPaymentMethod() {
      const selected = document.querySelector('input[name="co-payment-method"]:checked');
      return selected ? selected.value : 'cod';
    }

    function updateCheckoutPaymentUI() {
      const paymentMethod = getSelectedCheckoutPaymentMethod();
      const promptPayBox = document.getElementById('co-promptpay-box');
      const submitBtn = document.getElementById('co-submit-btn');
      promptPayBox.classList.toggle('hidden', paymentMethod !== 'promptpay');
      if (paymentMethod === 'promptpay') {
        submitBtn.innerHTML = '<i class="fas fa-check-circle"></i> ยืนยันและแจ้งชำระ';
      } else {
        clearPaymentSlip();
        submitBtn.innerHTML = '<i class="fas fa-check-circle"></i> ยืนยันการสั่งซื้อ';
      }
    }

    async function submitOrder() {
      const name    = document.getElementById('co-name').value.trim();
      const phone   = document.getElementById('co-phone').value.trim();
      const address = document.getElementById('co-address').value.trim();
      const note    = document.getElementById('co-note').value.trim();
      const paymentMethod = getSelectedCheckoutPaymentMethod();
      const errEl = document.getElementById('co-error');

      if (!name || !phone || !address) {
        errEl.textContent = 'กรุณากรอกข้อมูลให้ครบ (ชื่อ, เบอร์โทร, ที่อยู่)';
        errEl.classList.remove('hidden'); return;
      }
      if (!supabaseClient) {
        errEl.textContent = 'ยังไม่ได้เชื่อมต่อ Supabase กรุณาตั้งค่าก่อน';
        errEl.classList.remove('hidden'); return;
      }
      if (paymentMethod === 'promptpay' && !selectedPaymentSlip) {
        errEl.textContent = 'กรุณาแนบสลิปการโอนก่อนยืนยันคำสั่งซื้อ';
        errEl.classList.remove('hidden'); return;
      }

      const btn = document.getElementById('co-submit-btn');
      btn.disabled = true;
      btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> กำลังส่งคำสั่งซื้อ...';
      errEl.classList.add('hidden');

      try {
        const paymentSlipPayload = paymentMethod === 'promptpay'
          ? { file_name: selectedPaymentSlip.name, content_type: selectedPaymentSlip.type, base64: await paymentSlipToBase64(selectedPaymentSlip) }
          : null;

        const { data: order, error: orderErr } = await supabaseClient
          .from('orders')
          .insert({
            customer_name: name, customer_phone: phone, customer_address: address,
            note: note || null, payment_method: paymentMethod,
            payment_status: 'pending', payment_amount: 0, total_amount: cartTotal()
          })
          .select().single();

        if (orderErr) throw orderErr;

        const items = cart.map(i => ({
          order_id: order.id, product_id: i.productId, product_name: i.name,
          product_sku: i.sku || null, quantity: i.qty, unit_price: i.price
        }));

        const { error: itemsErr } = await supabaseClient.from('order_items').insert(items);
        if (itemsErr) throw itemsErr;

        const supabaseUrl = getStoredItem('zort_ws_supabase_url');
        const supabaseKey = getStoredItem('zort_ws_supabase_anon_key');
        let zortSyncWarning = '';
        if (supabaseUrl && supabaseKey) {
          try {
            const response = await fetch(`${supabaseUrl}/functions/v1/order-to-zort-payment`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${supabaseKey}`, 'apikey': supabaseKey },
              body: JSON.stringify({ order_id: order.id, payment_slip: paymentSlipPayload })
            });
            const text = await response.text();
            const payload = (() => { try { return JSON.parse(text); } catch { return { text }; } })();
            if (!response.ok) throw new Error(payload?.error || payload?.zort?.resDesc || `HTTP ${response.status}`);
            console.log('ZORT sync response:', payload);
          } catch (err) {
            console.error('ZORT sync error:', err);
            zortSyncWarning = 'บันทึกออเดอร์แล้ว แต่ส่งสลิปไป ZORT ไม่สำเร็จ ทางร้านจะตรวจสอบอีกครั้ง';
          }
        }

        cart = [];
        saveCart();
        updateCartBadge();
        document.getElementById('co-order-number').textContent = order.order_number || `#${order.id}`;
        document.getElementById('co-success-payment-note').textContent = zortSyncWarning || (
          paymentMethod === 'promptpay' ? 'ได้รับสลิปแล้ว สถานะ: รอตรวจสอบ' : 'ชำระเงินปลายทางเมื่อได้รับหนังสือ'
        );
        clearPaymentSlip();
        document.getElementById('checkout-form-section').classList.add('hidden');
        document.getElementById('checkout-success-section').classList.remove('hidden');
      } catch (err) {
        console.error('Order error:', err);
        errEl.textContent = 'เกิดข้อผิดพลาด: ' + err.message;
        errEl.classList.remove('hidden');
        btn.disabled = false;
        updateCheckoutPaymentUI();
      }
    }

    function scrollToCatalog() {
      const catalogSection = document.getElementById('catalog-section');
      if (catalogSection) {
        catalogSection.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }
    }

    function showToast(msg) {
      let t = document.getElementById('toast-msg');
      if (!t) {
        t = document.createElement('div');
        t.id = 'toast-msg';
        t.className = 'fixed bottom-6 left-1/2 -translate-x-1/2 bg-stone-900 text-white text-xs font-semibold px-5 py-3 rounded-xl shadow-xl z-[100] transition-opacity duration-300';
        document.body.appendChild(t);
      }
      t.textContent = msg;
      t.style.opacity = '1';
      clearTimeout(t._timer);
      t._timer = setTimeout(() => { t.style.opacity = '0'; }, 2500);
    }

    const _origOpen = openProductModal;
    openProductModal = function(productId) {
      currentModalProductId = productId;
      _origOpen(productId);
      const prod = localProducts.find(p => p.id === productId);
      const stockLimit = getProductStockLimit(prod);
      const qtyInput = document.getElementById('modal-qty');
      const addButton = document.getElementById('modal-add-to-cart');
      const increaseButton = document.getElementById('modal-qty-increase');
      const decreaseButton = document.getElementById('modal-qty-decrease');
      const isOutOfStock = stockLimit <= 0;

      qtyInput.value = isOutOfStock ? 0 : 1;
      qtyInput.min = isOutOfStock ? 0 : 1;
      qtyInput.max = Number.isFinite(stockLimit) ? String(stockLimit) : '';
      qtyInput.readOnly = isOutOfStock;
      addButton.disabled = isOutOfStock;
      addButton.classList.toggle('opacity-50', isOutOfStock);
      addButton.classList.toggle('cursor-not-allowed', isOutOfStock);
      increaseButton.disabled = isOutOfStock;
      decreaseButton.disabled = isOutOfStock;
      increaseButton.classList.toggle('opacity-40', isOutOfStock);
      decreaseButton.classList.toggle('opacity-40', isOutOfStock);
    };

    window.addEventListener('DOMContentLoaded', () => {
      initTheme();
      initSupabase();
      loadProducts();
      updateCartBadge();
    });

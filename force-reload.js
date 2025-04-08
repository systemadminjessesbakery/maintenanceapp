/**
 * Force Reload Utility
 * Forces immediate reload of pages by clearing cache storage and service workers
 */
(function() {
  // Run immediately
  const FORCE_RELOAD_VERSION = Date.now().toString();
  
  // Check if we need to force reload
  const lastPageLoad = localStorage.getItem('lastPageLoad');
  const currentPageLoad = Date.now().toString();
  
  // Store current load time
  localStorage.setItem('lastPageLoad', currentPageLoad);
  
  // If we've stored a last page load time and it's more than 30 seconds old
  // or if we haven't visited in over 5 minutes, force a clean reload
  if (lastPageLoad) {
    const timeSinceLastLoad = Date.now() - parseInt(lastPageLoad);
    const needsReload = timeSinceLastLoad > 300000; // 5 minutes
    
    if (needsReload) {
      console.log('Force reloading page due to inactivity...');
      forceReload();
    }
  }
  
  // Function to force a complete reload
  function forceReload() {
    // Clear all client-side storage that might affect page loading
    try {
      // Clear service worker caches
      if ('caches' in window) {
        caches.keys().then(names => {
          names.forEach(name => {
            caches.delete(name);
            console.log(`Cache ${name} deleted`);
          });
        });
      }
      
      // Clear Application Cache
      if (window.applicationCache) {
        window.applicationCache.swapCache();
      }
      
      // Clear session storage
      sessionStorage.clear();
      
      // Store reload marker
      localStorage.setItem('forceReloaded', 'true');
      
      // Force hard reload
      window.location.reload(true);
    } catch (e) {
      console.error('Error during forced reload:', e);
      
      // Last resort - try to reload anyway
      window.location.href = window.location.href.split('?')[0] + '?forceReload=' + Date.now();
    }
  }
  
  // Expose force reload function
  window.forceReload = forceReload;
  
  // Check if we just did a force reload
  if (localStorage.getItem('forceReloaded') === 'true') {
    console.log('Page was force reloaded');
    localStorage.removeItem('forceReloaded');
  }
  
  // Add reload link in console for developers
  console.log('%cTo force reload: run forceReload() in console', 'color: green; font-weight: bold');
})(); 
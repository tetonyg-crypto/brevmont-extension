/**
 * Brevmont Network Interceptor
 * Loaded as a web_accessible_resource to bypass CSP.
 * Monkey-patches window.fetch to capture customer/lead/contact API responses
 * and postMessage the extracted data to the content script.
 */
(function() {
  const originalFetch = window.fetch;
  window.fetch = function(...args) {
    return originalFetch.apply(this, args).then(response => {
      const url = typeof args[0] === 'string' ? args[0] : args[0]?.url || '';
      if (url.includes('customer') || url.includes('lead') || url.includes('contact')) {
        response.clone().json().then(data => {
          try {
            const extracted = {};
            const str = JSON.stringify(data);
            const firstName = str.match(/"(?:firstName|first_name)"\s*:\s*"([^"]+)"/i);
            const lastName = str.match(/"(?:lastName|last_name)"\s*:\s*"([^"]+)"/i);
            if (firstName) extracted.customerName = firstName[1] + (lastName ? ' ' + lastName[1] : '');
            const vehicle = str.match(/"(?:vehicle|vehicleDescription)"\s*:\s*"([^"]+)"/i);
            if (vehicle) extracted.vehicle = vehicle[1];
            const phone = str.match(/"(?:phone|phoneNumber)"\s*:\s*"([^"]+)"/i);
            if (phone) extracted.phone = phone[1];
            const email = str.match(/"(?:email|emailAddress)"\s*:\s*"([^"]+)"/i);
            if (email) extracted.email = email[1];
            if (Object.keys(extracted).length > 0) {
              window.postMessage({ type: 'OPER8ER_LEAD_DATA', data: extracted }, '*');
            }
          } catch(x) {}
        }).catch(() => {});
      }
      return response;
    });
  };
})();

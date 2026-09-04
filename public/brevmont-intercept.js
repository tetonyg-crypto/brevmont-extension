/**
 * Brevmont lead-field reader (runs in the page context).
 *
 * The rep is already viewing their own customer record in their dealer CRM.
 * This script reads the lead's name/vehicle/phone/email from that same CRM's
 * API response the page just loaded, so the rep does not have to retype it into
 * Brevmont. It runs only on the CRM/inbox domains the extension is granted, does
 * not modify requests, and sends the fields only to the extension's own content
 * script on the same page (same-origin postMessage). No data leaves the page
 * except through the extension's normal, authenticated flow.
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
              // Same-origin only: the extension's content script runs in this
              // page's origin and verifies event.source === window.
              window.postMessage({ type: 'BREVMONT_LEAD_DATA', data: extracted }, window.location.origin);
            }
          } catch(x) {}
        }).catch(() => {});
      }
      return response;
    });
  };
})();

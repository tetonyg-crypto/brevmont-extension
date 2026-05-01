/**
 * Mock VinSolutions data — used by test HTML pages.
 * Mirrors the data shape the extension extracts from real VinSolutions pages.
 */
window.MOCK_DATA = {
  leads: [
    {
      id: 'L001',
      name: 'Test Customer Alpha',
      phone: '(307) 555-0100',
      email: 'alpha@testcustomer.internal',
      vehicle: '2024 Ford F-150 XLT 4WD',
      status: 'Hot',
      lastContact: '2026-04-29',
      salesperson: 'Test Rep One',
      source: 'Website',
    },
    {
      id: 'L002',
      name: 'Test Customer Beta',
      phone: '(307) 555-0101',
      email: 'beta@testcustomer.internal',
      vehicle: '2023 Toyota Tacoma TRD Off-Road',
      status: 'Working',
      lastContact: '2026-04-28',
      salesperson: 'Test Rep Two',
      source: 'Phone',
    },
    {
      id: 'L003',
      name: 'Test Customer Gamma',
      phone: '(307) 555-0102',
      email: 'gamma@testcustomer.internal',
      vehicle: '2024 Chevrolet Silverado 1500 LT',
      status: 'Cold',
      lastContact: '2026-04-25',
      salesperson: 'Test Rep One',
      source: 'Walk-in',
    },
  ],
  currentCustomer: {
    id: 'L001',
    name: 'Test Customer Alpha',
    phone: '(307) 555-0100',
    email: 'alpha@testcustomer.internal',
    vehicle: '2024 Ford F-150 XLT 4WD',
    vin: '1FTFW1E87RFA00001',
    stockNumber: 'ST-2024-001',
    price: '$52,850',
    mileage: '0',
    year: '2024',
    make: 'Ford',
    model: 'F-150',
    trim: 'XLT',
    color: 'Velocity Blue',
    salesperson: 'Test Rep One',
    notes: [],
  },
};

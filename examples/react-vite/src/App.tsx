const items = [
  { id: 'tee', name: 'Logo tee', price: 24 },
  { id: 'mug', name: 'Enamel mug', price: 16 },
  { id: 'cap', name: 'Dad cap', price: 22 },
];

export function App() {
  const total = items.reduce((sum, i) => sum + i.price, 0);
  return (
    <main className="page">
      <header className="masthead">
        <h1>Checkout</h1>
        <p className="lede">A small demo page to pin comments on.</p>
      </header>
      <section className="card" aria-labelledby="cart-heading" data-testid="cart">
        <h2 id="cart-heading">Your cart</h2>
        <ul className="cart">
          {items.map((item) => (
            <li key={item.id} data-testid={`cart-item-${item.id}`}>
              <span>{item.name}</span>
              <span>${item.price}</span>
            </li>
          ))}
        </ul>
        <p className="total">
          Total <strong data-testid="cart-total">${total}</strong>
        </p>
        <button type="button" className="cta" data-testid="checkout-button">
          Place order
        </button>
      </section>
    </main>
  );
}

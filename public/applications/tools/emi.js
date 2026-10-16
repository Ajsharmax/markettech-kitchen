const fmt = value => new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 0 }).format(value);
const number = value => Number.parseFloat(value) || 0;

export function calculateEmi(principal, annualRate, months) {
  principal = Math.min(10_000_000, Math.max(1_000, Math.round(Number(principal) || 1_000)));
  annualRate = Math.min(50, Math.max(0, Number(annualRate) || 0));
  months = Math.min(360, Math.max(1, Math.round(Number(months) || 1)));
  const monthlyRate = annualRate / 12 / 100;
  const emi = monthlyRate === 0
    ? principal / months
    : principal * monthlyRate * (1 + monthlyRate) ** months / ((1 + monthlyRate) ** months - 1);
  let balance = principal;
  const schedule = [];
  for (let month = 1; month <= months; month++) {
    const interest = monthlyRate === 0 ? 0 : balance * monthlyRate;
    const principalPaid = Math.min(emi - interest, balance);
    balance = Math.max(0, balance - principalPaid);
    schedule.push({ month, payment: principalPaid + interest, principal: principalPaid, interest, balance });
  }
  return { emi, total: emi * months, interest: Math.max(0, emi * months - principal), schedule };
}

function money(value) { return fmt(Math.round(value)); }

function render(root) {
  root.innerHTML = `
    <section class="tk-panel emi-layout" aria-label="EMI calculator">
      <div class="emi-inputs">
        <div class="tk-field"><label for="emi-amount">Loan amount</label><div class="emi-input-wrap"><span>₹</span><input id="emi-amount" type="number" min="1000" max="10000000" step="1000" value="500000" inputmode="decimal"></div><input data-for="emi-amount" type="range" min="10000" max="10000000" step="10000" value="500000" aria-label="Loan amount slider"><small>₹1,000 to ₹1 crore</small></div>
        <div class="tk-field"><label for="emi-rate">Annual interest rate</label><div class="emi-input-wrap"><input id="emi-rate" type="number" min="0" max="50" step="0.1" value="10.5" inputmode="decimal"><span>%</span></div><input data-for="emi-rate" type="range" min="0" max="50" step="0.1" value="10.5" aria-label="Interest rate slider"><small>0% to 50% per year</small></div>
        <div class="tk-field"><label for="emi-tenure">Loan tenure</label><div class="emi-input-wrap"><input id="emi-tenure" type="number" min="1" max="360" step="1" value="60" inputmode="numeric"><span>months</span></div><input data-for="emi-tenure" type="range" min="1" max="360" step="1" value="60" aria-label="Loan tenure slider"><small><span id="emi-years">5 years</span></small></div>
      </div>
      <div class="emi-result-card"><p class="emi-label">YOUR MONTHLY EMI</p><output id="emi-value" class="emi-value">₹10,747</output><div class="emi-breakdown"><div><span>Principal amount</span><strong id="emi-principal">₹5,00,000</strong></div><div><span>Total interest</span><strong id="emi-interest">₹1,44,808</strong></div><div><span>Total repayment</span><strong id="emi-total">₹6,44,808</strong></div></div></div>
    </section>
    <section class="tk-panel"><div class="emi-schedule-head"><h2>Amortization schedule</h2><button id="emi-toggle" class="tk-btn" type="button">Show schedule</button></div><p class="tk-note">A month-by-month estimate of how each payment is split between principal and interest.</p><div id="emi-table-wrap" hidden></div></section>
    <p class="tk-note">This calculator provides an estimate. Actual EMI may vary due to lender fees, taxes, insurance, processing charges, or changing interest rates.</p>`;

  const amount = root.querySelector("#emi-amount");
  const rate = root.querySelector("#emi-rate");
  const tenure = root.querySelector("#emi-tenure");
  const years = root.querySelector("#emi-years");
  const tableWrap = root.querySelector("#emi-table-wrap");
  const toggle = root.querySelector("#emi-toggle");
  let latest = null;

  function update() {
    const principal = Math.min(10_000_000, Math.max(1_000, Math.round(number(amount.value) || 1_000)));
    const annualRate = Math.min(50, Math.max(0, number(rate.value)));
    const months = Math.min(360, Math.max(1, Math.round(number(tenure.value) || 1)));
    amount.value = principal; rate.value = annualRate; tenure.value = months;
    root.querySelector('[data-for="emi-amount"]').value = principal;
    root.querySelector('[data-for="emi-rate"]').value = annualRate;
    root.querySelector('[data-for="emi-tenure"]').value = months;
    years.textContent = `${(months / 12).toFixed(months % 12 ? 1 : 0)} years`;
    latest = calculateEmi(principal, annualRate, months);
    root.querySelector("#emi-value").textContent = money(latest.emi);
    root.querySelector("#emi-principal").textContent = money(principal);
    root.querySelector("#emi-interest").textContent = money(latest.interest);
    root.querySelector("#emi-total").textContent = money(latest.total);
    if (!tableWrap.hidden) renderTable();
  }
  function renderTable() {
    tableWrap.innerHTML = `<div class="emi-table-scroll"><table><thead><tr><th>Month</th><th>Payment</th><th>Principal</th><th>Interest</th><th>Balance</th></tr></thead><tbody>${latest.schedule.map(row => `<tr><td>${row.month}</td><td>${money(row.payment)}</td><td>${money(row.principal)}</td><td>${money(row.interest)}</td><td>${money(row.balance)}</td></tr>`).join("")}</tbody></table></div>`;
  }
  [amount, rate, tenure].forEach(input => input.addEventListener("input", update));
  root.querySelectorAll("input[type=range]").forEach(slider => slider.addEventListener("input", () => { root.querySelector(`#${slider.dataset.for}`).value = slider.value; update(); }));
  toggle.addEventListener("click", () => { tableWrap.hidden = !tableWrap.hidden; toggle.textContent = tableWrap.hidden ? "Show schedule" : "Hide schedule"; if (!tableWrap.hidden) renderTable(); });
  update();
}

export default {
  emi: { custom: true, mount: render }
};

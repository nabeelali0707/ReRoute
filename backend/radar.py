"""Risk Radar: proactive schedule and country-risk monitoring across open purchase orders.

Schedule risk follows an explainable rule: days late divided by days until the
item is needed (under 5% low, under 15% medium, otherwise high). Country risk
adds the severity of current risk signals for the order's origin. All records
here are synthetic demo data and are labelled as such in the UI.
"""

# Synthetic open purchase orders. promised_days is the supplier's current estimate;
# required_days is when the site needs the item.
ORDERS = [
    dict(id='PO-2401', item='USB-C network adapter', quantity=20, supplier='Original supplier (Shenzhen)', origin='China', destination='Islamabad · Engineering lab', value=150000, required_days=3, promised_days=10, certified_needed=True),
    dict(id='PO-2402', item='Temperature sensor', quantity=12, supplier='ThermoTech Penang', origin='Malaysia', destination='Lahore · Assembly line', value=96000, required_days=6, promised_days=8, certified_needed=False),
    dict(id='PO-2403', item='Industrial ethernet switch', quantity=4, supplier='NetCore Hamburg', origin='Germany', destination='Karachi · Control room', value=420000, required_days=21, promised_days=22, certified_needed=True),
    dict(id='PO-2404', item='Solar charge controller', quantity=30, supplier='SunGrid Ningbo', origin='China', destination='Multan · Field site', value=270000, required_days=14, promised_days=15, certified_needed=False),
    dict(id='PO-2405', item='Safety relay module', quantity=16, supplier='Rele Istanbul', origin='Turkey', destination='Faisalabad · Plant 2', value=128000, required_days=10, promised_days=10, certified_needed=True),
    dict(id='PO-2406', item='Fiber optic patch cable', quantity=200, supplier='LightLink Dubai', origin='UAE', destination='Islamabad · Data centre', value=60000, required_days=12, promised_days=11, certified_needed=False),
    dict(id='PO-2407', item='PLC input module', quantity=8, supplier='AutoParts Pune', origin='India', destination='Lahore · Assembly line', value=184000, required_days=18, promised_days=20, certified_needed=True),
    dict(id='PO-2408', item='UPS battery pack', quantity=10, supplier='VoltStore Ho Chi Minh', origin='Vietnam', destination='Karachi · Control room', value=210000, required_days=9, promised_days=9, certified_needed=False),
]

# Synthetic risk signals by origin country (severity 1 low – 3 high).
SIGNALS = [
    dict(id='SIG-11', country='China', category='Port congestion', severity=2, headline='Yantian port congestion adds 3–5 days to outbound container dwell times.'),
    dict(id='SIG-12', country='China', category='Tariff change', severity=1, headline='Revised export documentation rules for electronic components take effect this month.'),
    dict(id='SIG-21', country='Malaysia', category='Weather', severity=2, headline='Monsoon flooding disrupts road freight around Penang industrial zones.'),
    dict(id='SIG-31', country='Germany', category='Labour', severity=1, headline='Rail freight union announces a 24-hour warning strike.'),
    dict(id='SIG-41', country='Turkey', category='Currency', severity=1, headline='Lira volatility prompts some suppliers to re-quote open orders.'),
    dict(id='SIG-51', country='India', category='Political', severity=2, headline='Regional transport strike affects highway logistics in Maharashtra.'),
    dict(id='SIG-61', country='Vietnam', category='Logistics', severity=1, headline='Peak-season airfreight capacity tight on Southeast Asia routes.'),
]

LEVELS = ['Low', 'Medium', 'High']


def schedule_risk(order):
    """RiskWise-style schedule risk: lateness as a share of the time remaining."""
    variance = order['promised_days'] - order['required_days']
    pct = round(max(variance, 0) / max(order['required_days'], 1) * 100, 1)
    level = 'Low' if pct < 5 else 'Medium' if pct < 15 else 'High'
    return variance, pct, level


def assess_order(order):
    variance, pct, schedule_level = schedule_risk(order)
    signals = [s for s in SIGNALS if s['country'] == order['origin']]
    country_score = sum(s['severity'] for s in signals)
    country_level = 'Low' if country_score <= 1 else 'Medium' if country_score <= 2 else 'High'
    # Overall: the worse of schedule risk and country risk.
    overall = max(LEVELS.index(schedule_level), LEVELS.index(country_level))
    factors = []
    if variance > 0:
        factors.append(f"{variance} day(s) late against a {order['required_days']}-day need ({pct}% schedule risk)")
    elif variance == 0:
        factors.append('No schedule slack: on time only if nothing slips')
    for s in signals:
        factors.append(f"{s['id']} {s['category']}: {s['headline']}")
    return dict(
        **order, variance_days=variance, schedule_risk_pct=pct, schedule_level=schedule_level,
        country_score=country_score, country_level=country_level, signal_ids=[s['id'] for s in signals],
        level=LEVELS[overall], factors=factors,
        value_at_risk=order['value'] if overall == 2 else round(order['value'] * 0.4) if overall == 1 else 0,
    )


def portfolio():
    orders = sorted((assess_order(o) for o in ORDERS), key=lambda o: (-LEVELS.index(o['level']), -o['schedule_risk_pct'], -o['value']))
    counts = {level: sum(o['level'] == level for o in orders) for level in LEVELS}
    return dict(
        source='Synthetic order book and risk-signal feed · Demo',
        orders=orders, signals=SIGNALS, counts=counts,
        value_at_risk=sum(o['value_at_risk'] for o in orders),
        rule_summary=rule_summary(orders),
    )


def rule_summary(orders):
    high = [o for o in orders if o['level'] == 'High']
    if not high:
        return 'No order is currently high risk. Keep monitoring medium-risk orders.'
    names = ', '.join(f"{o['id']} ({o['item']}, {o['origin']})" for o in high)
    return f"{len(high)} order(s) need attention now: {names}. Open a recovery case for each to compare alternatives before the need date."


def case_from_order(order):
    """Prefill a recovery case for a flagged order."""
    budget = round(order['value'] * 1.25 / 100) * 100
    late = f"{order['variance_days']} day(s) late" if order['variance_days'] > 0 else 'at risk of slipping'
    reasons = '; '.join(order['factors'][:3])
    return dict(
        title=f"{order['item']} at risk ({order['id']})"[:120], item=order['item'][:100], quantity=order['quantity'],
        location=order['destination'][:120],
        disruption=f"Risk Radar flagged {order['id']} from {order['supplier']}: {late}. {reasons}"[:2000],
        constraints=dict(budget=budget, deadline_days=order['required_days'], certified_only=False, excluded_suppliers=[]),
    )

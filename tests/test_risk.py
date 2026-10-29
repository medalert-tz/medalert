from app.services.risk import AdherenceFeatures, HeuristicRiskModel

m = HeuristicRiskModel(threshold=0.6)


def f(**kw):
    base = dict(doses_resolved_7d=14, miss_rate_7d=0.0, consecutive_misses=0,
                hours_since_device_seen=1.0, days_of_supply_left=10.0)
    base.update(kw)
    return AdherenceFeatures(**base)


def test_adherent_patient_is_low_risk():
    r = m.predict(f())
    assert r.level == "low" and r.factors == []


def test_occasional_miss_stays_below_threshold():
    assert m.predict(f(miss_rate_7d=1 / 14, consecutive_misses=1)).level != "high"


def test_pattern_of_misses_is_high_risk():
    r = m.predict(f(miss_rate_7d=0.5, consecutive_misses=2))
    assert r.level == "high"
    assert len(r.factors) == 2


def test_score_increases_with_each_signal():
    a = m.predict(f()).score
    b = m.predict(f(hours_since_device_seen=48)).score
    c = m.predict(f(hours_since_device_seen=48, days_of_supply_left=0.5)).score
    assert a < b < c


def test_no_history_is_flagged_not_high():
    r = m.predict(f(doses_resolved_7d=0, hours_since_device_seen=None, days_of_supply_left=None))
    assert r.level == "low"
    assert "Not enough dose history yet" in r.factors

"""
Aquatic ecosystem stability model — fixed version.
Fixes applied:
  1. fillna() chained assignment replaced with proper pandas 2.x syntax
  2. Resilience_Score array shape fixed (flatten 2D numpy -> 1D)
  3. Resilience_Score assigned safely back to DataFrame
  4. X feature matrix NaN fill uses assign pattern (no inplace on slice)
"""
import os
import numpy as np
import pandas as pd
from sklearn.preprocessing import MinMaxScaler
from sklearn.ensemble import RandomForestRegressor
from sklearn.linear_model import LinearRegression
from sklearn.model_selection import train_test_split
from sklearn.metrics import mean_absolute_error, r2_score

_DATA_DIR = os.path.join(os.path.dirname(__file__), "..", "data")
_CSV_PATH = os.path.join(_DATA_DIR, "Ecosystem Stability.csv")

_WEIGHTS = {
    "DO": 0.20, "Temp": 0.15, "pH": 0.15, "Turbidity": 0.15,
    "Conductivity": 0.10, "CHLA": 0.10, "SST": 0.10, "Capture": 0.05,
}
_NEGATIVE_FEATURES = ["Capture", "SST", "Temp", "Turbidity", "Conductivity", "CHLA"]


def _classify(score: float) -> str:
    if score >= 80:   return "Healthy"
    elif score >= 60: return "Stable"
    elif score >= 40: return "Vulnerable"
    elif score >= 20: return "Unstable"
    return "Critical"


def _risk_category(risk: float) -> str:
    if risk <= 20:   return "Stable"
    elif risk <= 40: return "Vulnerable"
    elif risk <= 60: return "High Risk"
    return "Critical"


def _build_pipeline(df: pd.DataFrame):
    df = df.sort_values(["Year", "Month"]).reset_index(drop=True)

    features   = df.drop(columns=["Year", "Month"])
    scaler     = MinMaxScaler()
    scaled_arr = scaler.fit_transform(features)
    scaled_df  = pd.DataFrame(scaled_arr, columns=features.columns)
    scaled_df["Year"]  = df["Year"].values
    scaled_df["Month"] = df["Month"].values

    # FIX: assign back directly, not via chained inplace
    for col in _NEGATIVE_FEATURES:
        scaled_df[col] = 1 - scaled_df[col]

    # Weighted stability index
    scaled_df["Stability_Index"] = sum(
        scaled_df[k] * v for k, v in _WEIGHTS.items()
    )

    # Derived features — FIX: use direct column assignment, not fillna(inplace=True)
    scaled_df["Biomass_Index"] = (
        scaled_df["CHLA"] * 0.6 + scaled_df["Capture"] * 0.4
    )

    scaled_df["Temp_Flux"]      = scaled_df["Temp"].diff().abs()
    scaled_df["Oxygen_Flux"]    = scaled_df["DO"].diff().abs()
    scaled_df["Turbidity_Flux"] = scaled_df["Turbidity"].diff().abs()

    bioflux = (
        scaled_df["Temp_Flux"] + scaled_df["Oxygen_Flux"] + scaled_df["Turbidity_Flux"]
    ) / 3
    # FIX: fillna without inplace on a slice
    scaled_df["Bioflux_Index"] = bioflux.fillna(bioflux.mean())

    raw_res = scaled_df["Stability_Index"] / (
        scaled_df["Stability_Index"].rolling(6).std() + 0.0001
    )
    raw_res = raw_res.fillna(raw_res.mean())

    # FIX: flatten 2D numpy array to 1D before assigning back to column
    scaled_df["Resilience_Score"] = (
        MinMaxScaler().fit_transform(raw_res.values.reshape(-1, 1)).flatten() * 100
    )

    scaled_df["Stability_Status"] = (scaled_df["Stability_Index"] * 100).apply(_classify)
    scaled_df["Rolling_Mean"]     = scaled_df["Stability_Index"].rolling(6).mean()
    scaled_df["Rolling_Variance"] = scaled_df["Stability_Index"].rolling(6).var()
    scaled_df["Rolling_STD"]      = scaled_df["Stability_Index"].rolling(6).std()
    scaled_df["Lag1"]             = scaled_df["Stability_Index"].shift(1)

    # ML model — exclude leaky columns
    X = scaled_df.drop(columns=[
        "Year", "Month", "Stability_Index",
        "Rolling_Mean", "Rolling_Variance", "Rolling_STD",
        "Lag1", "Stability_Status",
    ])
    # FIX: clean without chained inplace
    X = (X
         .apply(pd.to_numeric, errors="coerce")
         .replace([np.inf, -np.inf], np.nan)
         .fillna(0))

    y = scaled_df["Stability_Index"]

    X_train, X_test, y_train, y_test = train_test_split(
        X, y, test_size=0.2, random_state=42
    )
    rf = RandomForestRegressor(n_estimators=100, random_state=42)
    rf.fit(X_train, y_train)
    pred = rf.predict(X_test)

    return scaled_df, rf, X, y_test, pred


def _build_response(scaled_df: pd.DataFrame, rf, X, y_test, pred) -> dict:
    stability_series  = (scaled_df["Stability_Index"] * 100).tolist()
    current_stability = round(stability_series[-1], 2)
    risk_score        = round(100 - current_stability, 2)

    vals        = np.array(stability_series)
    trend_slope = float(
        LinearRegression()
        .fit(np.arange(len(vals)).reshape(-1, 1), vals)
        .coef_[0]
    )

    importance = {
        col: round(float(imp), 4)
        for col, imp in zip(X.columns.tolist(), rf.feature_importances_.tolist())
    }

    trend_data = [
        {
            "year":             int(row["Year"]),
            "month":            int(row["Month"]),
            "stability_score":  round(float(row["Stability_Index"]) * 100, 2),
            "resilience_score": round(float(row["Resilience_Score"]), 2),
            "status":           row["Stability_Status"],
        }
        for _, row in scaled_df.iterrows()
    ]

    return {
        "ecosystem":            "aquatic",
        "stability_score":      current_stability,
        "collapse_risk_score":  risk_score,
        "status":               _classify(current_stability),
        "risk_category":        _risk_category(risk_score),
        "trend_slope":          round(trend_slope, 6),
        "trend_direction":      "improving" if trend_slope > 0 else "declining",
        "model_metrics": {
            "mae": round(float(mean_absolute_error(y_test, pred)), 4),
            "r2":  round(float(r2_score(y_test, pred)), 4),
        },
        "feature_importance":   importance,
        "trend_data":           trend_data,
        "status_distribution":  scaled_df["Stability_Status"].value_counts().to_dict(),
    }


def run_aquatic_model() -> dict:
    df = pd.read_csv(_CSV_PATH)
    scaled_df, rf, X, y_test, pred = _build_pipeline(df)
    return _build_response(scaled_df, rf, X, y_test, pred)


def run_aquatic_simulation(
    capture_change: float = 0,
    temp_change: float = 0,
    turbidity_change: float = 0,
) -> dict:
    df = pd.read_csv(_CSV_PATH)
    if capture_change != 0:
        df["Capture"]   = df["Capture"]   * (1 + capture_change / 100)
    if temp_change != 0:
        df["Temp"]      = df["Temp"]      * (1 + temp_change / 100)
    if turbidity_change != 0:
        df["Turbidity"] = df["Turbidity"] * (1 + turbidity_change / 100)

    scaled_df, rf, X, y_test, pred = _build_pipeline(df)
    result = _build_response(scaled_df, rf, X, y_test, pred)
    result["simulated"] = True
    result["simulation_params"] = {
        "capture_change":   capture_change,
        "temp_change":      temp_change,
        "turbidity_change": turbidity_change,
    }
    return result

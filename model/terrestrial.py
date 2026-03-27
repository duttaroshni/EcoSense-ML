"""
Terrestrial ecosystem stability model — fixed version.
Fixes applied:
  1. fillna(inplace=True) on slices replaced with direct assignment
  2. Resilience_Score shape fix (flatten 2D numpy -> 1D)
  3. X fillna uses safe pattern (no chained assignment)
  4. df.fillna uses numeric_only-safe pattern
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
_CSV_PATH = os.path.join(_DATA_DIR, "Ecosystem Stability Terrestrial.csv")

_NEGATIVE_COLS = [
    "Average Temperature",
    "Average of CO2 Level",
    "Count of Extreme Weather Event",
    "Sum of Economic Impact",
    "Sum of Population Affected",
    "Average of Habitat Fragmentation Score",
    "Average of Deforestation Pressure Index",
]

_STABILITY_WEIGHTS = {
    "Average of Wildlife Population Index":    0.15,
    "Average of Vegetation Index":             0.15,
    "Average of Soil Moisture":                0.10,
    "Average Temperature":                     0.10,
    "Average of CO2 Level":                    0.10,
    "Count of Extreme Weather Event":          0.10,
    "Sum of Economic Impact":                  0.10,
    "Sum of Population Affected":              0.10,
    "Average of Habitat Fragmentation Score":  0.05,
    "Average of Deforestation Pressure Index": 0.05,
}


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

    # FIX: fillna on the full DataFrame (numeric_only-safe)
    num_cols = df.select_dtypes(include=[np.number]).columns
    df[num_cols] = df[num_cols].fillna(df[num_cols].mean())

    # Log-transform skewed economic columns before scaling
    df["Sum of Economic Impact"]     = np.log1p(df["Sum of Economic Impact"])
    df["Sum of Population Affected"] = np.log1p(df["Sum of Population Affected"])

    features   = df.drop(columns=["Year", "Month"])
    scaler     = MinMaxScaler()
    scaled_arr = scaler.fit_transform(features)
    scaled_df  = pd.DataFrame(scaled_arr, columns=features.columns)
    scaled_df["Year"]  = df["Year"].values
    scaled_df["Month"] = df["Month"].values

    # FIX: direct column assignment, not chained inplace
    for col in _NEGATIVE_COLS:
        scaled_df[col] = 1 - scaled_df[col]

    scaled_df["Stability_Index"] = sum(
        scaled_df[col] * w for col, w in _STABILITY_WEIGHTS.items()
    )
    scaled_df["Stability_Status"] = (scaled_df["Stability_Index"] * 100).apply(_classify)

    scaled_df["Biomass_Index"] = (
        scaled_df["Average of Vegetation Index"]
        + scaled_df["Average of Wildlife Population Index"]
    ) / 2

    raw_bioflux = scaled_df["Average of Vegetation Index"].diff().abs()
    # FIX: fillna without inplace on a slice
    scaled_df["Bioflux_Index"] = raw_bioflux.fillna(raw_bioflux.mean())

    raw_res = scaled_df["Stability_Index"] / (
        scaled_df["Stability_Index"].rolling(6).std() + 0.0001
    )
    raw_res = raw_res.fillna(raw_res.mean())

    # FIX: flatten 2D array to 1D
    scaled_df["Resilience_Score"] = (
        MinMaxScaler().fit_transform(raw_res.values.reshape(-1, 1)).flatten() * 100
    )

    scaled_df["Rolling_Mean"] = scaled_df["Stability_Index"].rolling(6).mean()
    scaled_df["Rolling_STD"]  = scaled_df["Stability_Index"].rolling(6).std()

    X = scaled_df.drop(columns=["Year", "Month", "Stability_Index", "Stability_Status"])

    # FIX: safe NaN fill without chained assignment
    X = X.fillna(X.select_dtypes(include=[np.number]).mean())

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
        "ecosystem":           "terrestrial",
        "stability_score":     current_stability,
        "collapse_risk_score": risk_score,
        "status":              _classify(current_stability),
        "risk_category":       _risk_category(risk_score),
        "trend_slope":         round(trend_slope, 6),
        "trend_direction":     "improving" if trend_slope > 0 else "declining",
        "model_metrics": {
            "mae": round(float(mean_absolute_error(y_test, pred)), 4),
            "r2":  round(float(r2_score(y_test, pred)), 4),
        },
        "feature_importance":  importance,
        "trend_data":          trend_data,
        "status_distribution": scaled_df["Stability_Status"].value_counts().to_dict(),
    }


def run_terrestrial_model() -> dict:
    df = pd.read_csv(_CSV_PATH)
    scaled_df, rf, X, y_test, pred = _build_pipeline(df)
    return _build_response(scaled_df, rf, X, y_test, pred)


def run_terrestrial_simulation(
    temp_change: float = 0,
    co2_change: float = 0,
    deforestation_change: float = 0,
    soil_change: float = 0,
) -> dict:
    df = pd.read_csv(_CSV_PATH)
    if temp_change != 0:
        df["Average Temperature"] = df["Average Temperature"] * (1 - temp_change / 100)
    if co2_change != 0:
        df["Average of CO2 Level"] = df["Average of CO2 Level"] * (1 - co2_change / 100)
    if deforestation_change != 0:
        df["Average of Deforestation Pressure Index"] = (
            df["Average of Deforestation Pressure Index"] * (1 - deforestation_change / 100)
        )
    if soil_change != 0:
        df["Average of Soil Moisture"] = df["Average of Soil Moisture"] * (1 + soil_change / 100)

    scaled_df, rf, X, y_test, pred = _build_pipeline(df)
    result = _build_response(scaled_df, rf, X, y_test, pred)
    result["simulated"] = True
    result["simulation_params"] = {
        "temp_change":          temp_change,
        "co2_change":           co2_change,
        "deforestation_change": deforestation_change,
        "soil_change":          soil_change,
    }
    return result

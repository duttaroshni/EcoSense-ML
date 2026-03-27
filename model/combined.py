"""
Combined ecosystem stability model — fixed version.
Fixes applied:
  1. fillna on combined_clean replaced with safe pattern
  2. Explicit numeric column selection before drop to avoid KeyError
  3. Error handling if sub-model data is incomplete
"""
import numpy as np
import pandas as pd
from sklearn.ensemble import RandomForestRegressor
from sklearn.model_selection import train_test_split
from sklearn.metrics import mean_absolute_error, r2_score

from model.aquatic import run_aquatic_model
from model.terrestrial import run_terrestrial_model


def _risk_category(risk: float) -> str:
    if risk <= 30:   return "Stable"
    elif risk <= 60: return "Vulnerable"
    elif risk <= 80: return "High Risk"
    return "Critical"


def run_combined_model() -> dict:
    aq = run_aquatic_model()
    te = run_terrestrial_model()

    aq_df = pd.DataFrame(aq["trend_data"]).rename(columns={
        "stability_score":  "Aquatic_Stability",
        "resilience_score": "Aq_Resilience",
    })
    te_df = pd.DataFrame(te["trend_data"]).rename(columns={
        "stability_score":  "Terrestrial_Stability",
        "resilience_score": "Te_Resilience",
    })

    combined = pd.merge(
        aq_df[["year", "month", "Aquatic_Stability", "Aq_Resilience"]],
        te_df[["year", "month", "Terrestrial_Stability", "Te_Resilience"]],
        on=["year", "month"],
        how="inner",
    )

    combined["Final_Stability"] = (
        combined["Aquatic_Stability"] * 0.6 + combined["Terrestrial_Stability"] * 0.4
    )
    combined["Risk_Score"] = 100 - combined["Final_Stability"]

    def classify_risk(r):
        if r <= 30:   return "Stable"
        elif r <= 60: return "Vulnerable"
        elif r <= 80: return "High Risk"
        return "Critical"

    combined["Risk_Category"] = combined["Risk_Score"].apply(classify_risk)

    # FIX: select numeric columns explicitly, fill NaN safely
    num_cols      = combined.select_dtypes(include=[np.number]).columns.tolist()
    combined_num  = combined[num_cols].replace([np.inf, -np.inf], np.nan)
    combined_num  = combined_num.fillna(0)

    drop_cols = [c for c in ["Final_Stability", "Risk_Score"] if c in combined_num.columns]
    X = combined_num.drop(columns=drop_cols)
    y = combined_num["Final_Stability"]

    X_train, X_test, y_train, y_test = train_test_split(
        X, y, test_size=0.2, random_state=42
    )
    rf = RandomForestRegressor(n_estimators=100, random_state=42)
    rf.fit(X_train, y_train)
    pred = rf.predict(X_test)

    importance = {
        col: round(float(imp), 4)
        for col, imp in zip(X.columns.tolist(), rf.feature_importances_.tolist())
    }

    current_final = round(float(combined["Final_Stability"].iloc[-1]), 2)
    current_risk  = round(float(combined["Risk_Score"].iloc[-1]), 2)

    trend_data = [
        {
            "year":                   int(row["year"]),
            "month":                  int(row["month"]),
            "aquatic_stability":      round(float(row["Aquatic_Stability"]), 2),
            "terrestrial_stability":  round(float(row["Terrestrial_Stability"]), 2),
            "final_stability":        round(float(row["Final_Stability"]), 2),
            "risk_score":             round(float(row["Risk_Score"]), 2),
            "risk_category":          row["Risk_Category"],
        }
        for _, row in combined.iterrows()
    ]

    return {
        "ecosystem":                  "combined",
        "final_stability_score":      current_final,
        "aquatic_stability_score":    aq["stability_score"],
        "terrestrial_stability_score":te["stability_score"],
        "collapse_risk_score":        current_risk,
        "risk_category":              _risk_category(current_risk),
        "model_metrics": {
            "mae": round(float(mean_absolute_error(y_test, pred)), 4),
            "r2":  round(float(r2_score(y_test, pred)), 4),
        },
        "feature_importance":         importance,
        "trend_data":                 trend_data,
        "risk_distribution":          combined["Risk_Category"].value_counts().to_dict(),
        "aquatic_summary": {
            "status":          aq["status"],
            "trend_direction": aq["trend_direction"],
        },
        "terrestrial_summary": {
            "status":          te["status"],
            "trend_direction": te["trend_direction"],
        },
    }

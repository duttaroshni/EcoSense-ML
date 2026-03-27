# 🌿 EcoSense — Ecosystem Stability & Collapse Risk Assessment

> ML-based decision-support system for ecosystem health monitoring.  
> Supports **SDG 14** (Life Below Water) and **SDG 15** (Life on Land).

---

## Project Structure

```
ecosystem_project/
├── app.py                  ← Flask backend (API + serve frontend)
├── requirements.txt
├── run.sh                  ← One-command local startup
├── Procfile                ← For Heroku deployment
├── render.yaml             ← For Render.com deployment
├── model/
│   ├── __init__.py
│   ├── aquatic.py          ← Aquatic ML pipeline
│   ├── terrestrial.py      ← Terrestrial ML pipeline
│   └── combined.py         ← Merged analysis
├── data/
│   ├── Ecosystem Stability.csv               ← Aquatic data
│   └── Ecosystem Stability Terrestrial.csv   ← Terrestrial data
└── templates/
    └── index.html          ← Full dashboard frontend
```

---

## Quick Start (Local)

### Option A — Shell script (Mac/Linux)
```bash
cd ecosystem_project
bash run.sh
```
Open http://127.0.0.1:5000

### Option B — Manual steps (Windows / all OS)
```bash
cd ecosystem_project

# Create virtual environment
python -m venv .venv

# Activate
# Windows:
.venv\Scripts\activate
# Mac/Linux:
source .venv/bin/activate

# Install dependencies
pip install -r requirements.txt

# Run
python app.py
```
Open http://127.0.0.1:5000

### No CSV data yet?
If your `data/` folder is empty, click **"Generate Sample Data"** on any error screen — the app will synthesize realistic 2013–2020 datasets automatically.  
Or place your real CSVs in `data/` before starting.

---

## API Endpoints

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/aquatic` | Full aquatic model results |
| GET | `/api/terrestrial` | Full terrestrial model results |
| GET | `/api/combined` | Combined 60/40 weighted analysis |
| POST | `/api/simulate/aquatic` | What-if simulation (aquatic) |
| POST | `/api/simulate/terrestrial` | What-if simulation (terrestrial) |
| POST | `/api/generate-sample-data` | Auto-generate sample CSVs |

### Simulation Payload — Aquatic
```json
{ "capture_change": -30, "temp_change": -10, "turbidity_change": -20 }
```

### Simulation Payload — Terrestrial
```json
{ "temp_change": 20, "co2_change": 15, "deforestation_change": 30, "soil_change": 10 }
```

---

## Deploy Live (Free — Render.com)

1. Push this folder to a GitHub repo
2. Go to [render.com](https://render.com) → New Web Service → Connect repo
3. Render auto-detects `render.yaml` — click **Deploy**
4. Your live URL: `https://ecosense.onrender.com` (or similar)

---

## ML Architecture

| Component | Method |
|-----------|--------|
| Feature scaling | MinMaxScaler |
| Stability index | Weighted sum of normalised indicators |
| Prediction | RandomForestRegressor (100 trees) |
| Trend | LinearRegression on stability time-series |
| Early warning | Rolling std / variance of stability index |
| Explainability | RF feature importances |
| Simulation | Re-run pipeline with modified raw inputs |

---

## Data Requirements

### Aquatic CSV columns
`Year, Month, DO, Temp, pH, Turbidity, Conductivity, CHLA, SST, Capture`

### Terrestrial CSV columns
`Year, Month, Average of Wildlife Population Index, Average of Vegetation Index, Average of Soil Moisture, Average Temperature, Average of CO2 Level, Count of Extreme Weather Event, Sum of Economic Impact, Sum of Population Affected, Average of Habitat Fragmentation Score, Average of Deforestation Pressure Index`

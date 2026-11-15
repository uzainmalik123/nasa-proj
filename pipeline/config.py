"""Constants shared by every pipeline stage. See docs/contracts.md §4.

Both the ingest side (S1) and the science side (S2) import from here. Change a
value here, never inline a copy of it elsewhere.
"""

from __future__ import annotations

import os
from pathlib import Path

from dotenv import load_dotenv

# ---- paths -----------------------------------------------------------------
PIPELINE_DIR = Path(__file__).resolve().parent
REPO_DIR = PIPELINE_DIR.parent
DATA_DIR = PIPELINE_DIR / "data"  # gitignored on main; the data branch holds it
CACHE_DIR = DATA_DIR / "cache"
OUT_DIR = DATA_DIR / "out"
RAW_DIR = DATA_DIR / "raw"
PLACES_PARQUET = DATA_DIR / "places.parquet"
FEATURES_PARQUET = DATA_DIR / "features.parquet"
DASHBOARD_DATA_DIR = REPO_DIR / "dashboard" / "public" / "data"

load_dotenv(PIPELINE_DIR / ".env")

# ---- secrets (GitHub secrets in CI, pipeline/.env locally) ----------------
FIRMS_MAP_KEY = os.environ.get("FIRMS_MAP_KEY", "")
EARTHDATA_USERNAME = os.environ.get("EARTHDATA_USERNAME", "")
EARTHDATA_PASSWORD = os.environ.get("EARTHDATA_PASSWORD", "")

# ---- places ----------------------------------------------------------------
PLACE_TIER = 1  # PRD §13.2: 1 = capitals + cities over 1M (~600)
TIER_MIN_POP = {1: 1_000_000, 2: 300_000, 3: 300_000}
RADIUS_KM = 50  # watch radius around every place; also the dedupe distance
DEDUPE_KM = 50

# ---- dense Pakistan tier (PRD M9) -----------------------------------------
# places.tier: "pk" for the district rows appended by places/pakistan.py, null
# for the global tier (PLACE_TIER). The global constants above are untouched.
PK_TIER = "pk"
PK_RADIUS_KM = 30
PK_DEDUPE_KM = 30  # a district within this of a global place / larger district is skipped
POWER_COLD_MIN_NEW = 50  # ≥ this many places without a POWER cache → the cold G1 budget
POWER_TIER_REFRESH_H = 6  # tier places re-fetch POWER when the UTC hour divides by this

# ---- FIRMS -----------------------------------------------------------------
# Live dots. Probed 2026-11-14 03:30 UTC with world/1/<yesterday>:
#   VIIRS_NOAA21_NRT 46,378 rows · VIIRS_NOAA20_NRT 42,826 · VIIRS_SNPP_NRT 0
# (SNPP NRT stopped on 2026-11-02 per data_availability). Override via .env.
FIRMS_LIVE_SOURCE = os.environ.get("FIRMS_LIVE_SOURCE", "VIIRS_NOAA21_NRT")
FIRMS_COUNT_SOURCE = "MODIS_NRT"  # per-place counts for the live tail
FIRMS_HISTORY_SOURCE = "MODIS_SP"  # one-time 12-month history for labels
FIRMS_WORLD_MAX_DAYS = 5  # the API caps world/ requests at 5 days
FIRMS_HISTORY_MONTHS = 12
FIRMS_API = "https://firms.modaps.eosdis.nasa.gov/api/area/csv"
FIRMS_PACE_S = 0.5
FIRMS_BIN_DEG = 0.25  # fires_24h.json bin size
# Note for S1: world/1 with no date means "today UTC"; at 03:00 UTC it is
# nearly empty. Use world/1/<yesterday> or world/2 for the live layer.

# ---- POWER -----------------------------------------------------------------
POWER_API = "https://power.larc.nasa.gov/api/temporal/daily/point"
POWER_PARAMS = "T2M,T2M_MAX,PRECTOTCORR,RH2M,WS2M,GWETROOT,GWETTOP"
POWER_COMMUNITY = "AG"
POWER_PACE_S = 1.0
POWER_YEARS = 10

# ---- Open-Meteo ------------------------------------------------------------
OPENMETEO_API = "https://api.open-meteo.com/v1/forecast"
OPENMETEO_DAILY = (
    "temperature_2m_max,precipitation_sum,relative_humidity_2m_min,"
    "wind_speed_10m_max,et0_fao_evapotranspiration"
)
FORECAST_DAYS = 16

# ---- science windows -------------------------------------------------------
HORIZON_DAYS = 14  # hazard horizon and wildfire label window
LABEL_MIN_DETECTIONS = 3  # ≥3 detections within RADIUS_KM in the next 14 days
HISTORY_DAYS = 90  # series.json and risk history length
LONG_WINDOW_MONTHS = 120  # trends "10y" window, monthly means
SHORT_WINDOW_DAYS = 90  # trends "90d" window, daily values
TREND_P_SIGNIFICANT = 0.05
HOLDOUT_WEEKS = 6
ANOMALY_Z = 1.5  # |z| above this raises a "new_anomaly" alert
ALERT_Z = 2.0  # risk more than 2 sd above its own 90-day mean
ALERT_COOLDOWN_DAYS = 7
FEED_MAX = 50

# ---- fixed orderings (contracts §2) ---------------------------------------
HAZARDS = ["wildfire", "drought", "heat", "rain"]
VARIABLES = ["rain_mm", "tmax_c", "rh_pct", "wind_ms", "soil_wet", "fires"]
VARIABLE_UNITS = ["mm/yr", "°C/yr", "pct/yr", "m/s/yr", "frac/yr", "det/yr"]
KINDS = ["observation", "forecast", "risk_assessment", "trend"]
CONFIDENCE_LEVELS = ["high", "medium", "low"]
CATEGORIES = ["low", "elevated", "high", "extreme"]
TREND_LABELS = ["rising", "falling", "stable", "insufficient"]

# ---- category thresholds per hazard (quoted in the legend) ----------------
# Each maps category → the lowest value that enters it; anything below the
# "elevated" threshold is "low". Drought is a deficit index, so it descends.
CATEGORY_THRESHOLDS = {
    # probability; ≥ 3 detections in 14 days is common in the burning belts (base rate
    # 0.29), so the lines sit near today's 60th / 85th / 95th percentiles (S2-B, 14 Nov)
    "wildfire": {"elevated": 0.30, "high": 0.60, "extreme": 0.90},
    "drought": {"elevated": -0.5, "high": -1.0, "extreme": -1.5},  # std. index
    "heat": {"elevated": 1, "high": 3, "extreme": 7},  # days above 95th pct
    "rain": {"elevated": 0.10, "high": 0.25, "extreme": 0.50},  # probability
}

# ---- run gates (PRD §13.1) -------------------------------------------------
# 15 min was set for 554 places; POWER is a global one-request-per-second pace
# (KI-11), so a tier-due run with 666 places (PRD M9) is ~800 s before the
# ~90 s of science. 20 min keeps ~400 s of headroom for POWER retries.
G1_INCREMENTAL_MAX_S = 20 * 60
G1_COLD_MAX_S = 60 * 60
G2_MIN_COVERAGE = 0.98
G3_FIRMS_MAX_AGE_H = 6
G3_POWER_MAX_AGE_D = 4
G3_FORECAST_MAX_AGE_H = 12
G4_FIRMS_MIN_ROWS = 1000
G4_MIN_RISK_STD = 0.01
G6_JSON_MAX_BYTES = 5 * 1024 * 1024

# ---- misc ------------------------------------------------------------------
RUN_ID_FORMAT = "%Y%m%dT%H%MZ"
MOCK_N_PLACES = 20

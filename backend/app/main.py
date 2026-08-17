"""
app/main.py
───────────
FastAPI application entry-point.

Startup sequence:
  1. Create all DB tables (SQLAlchemy create_all — code-first migrations)
  2. Register CORS middleware (allows the Vite dev server at localhost:5173)
  3. Mount all route modules
  4. Health-check endpoint
"""

# Target AWS Deployment Account: 847013096108
import sys
import os
import logging
import time
import uuid

# Ensure the backend root is on the path so `db`, `routes`, etc. resolve
sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware

from db.database import engine, Base
from db import models  # noqa: F401 — needed so Base.metadata is populated
from routes.demo import router as demo_router
from routes.auth      import router as auth_router
from routes.users     import router as users_router
from routes.tenants   import router as tenants_router
from routes.surveys   import router as surveys_router
from routes.responses import router as responses_router
from routes.feedback  import router as feedback_router
from routes.dashboard import router as dashboard_router
from routes.utils     import router as utils_router
from routes.ai        import router as ai_router
from routes.payments  import router as payments_router
from routes.public    import router as public_router
from slowapi.errors import RateLimitExceeded
from slowapi.middleware import SlowAPIMiddleware
from fastapi.responses import JSONResponse
from sqlalchemy import text
from db.database import engine
from routes.demo import router as demo_router
from core import config
from core.rate_limiter import limiter

logging.basicConfig(level=os.getenv("LOG_LEVEL", "INFO"))
logger = logging.getLogger("axiora.api")

# ── Create tables ─────────────────────────────────────────────────────────────
# In production, replace this with Alembic migrations.



# ── App ───────────────────────────────────────────────────────────────────────
app = FastAPI(
    title="Nexora Pulse API",
    description="FastAPI backend for the Nexora Pulse survey science platform",
    version="1.0.0",
    docs_url="/docs",
    redoc_url="/redoc",
)

@app.middleware("http")
async def log_requests(request: Request, call_next):
    request_id = request.headers.get("x-request-id", str(uuid.uuid4()))
    start = time.perf_counter()

    try:
        response = await call_next(request)
    except Exception:
        duration_ms = round((time.perf_counter() - start) * 1000, 2)
        logger.exception(
            "api_request_failed",
            extra={
                "request_id": request_id,
                "method": request.method,
                "path": request.url.path,
                "duration_ms": duration_ms,
                "client": request.client.host if request.client else None,
            },
        )
        raise

    duration_ms = round((time.perf_counter() - start) * 1000, 2)
    log = logger.warning if response.status_code >= 400 else logger.info
    log(
        "api_request_completed",
        extra={
            "request_id": request_id,
            "method": request.method,
            "path": request.url.path,
            "status_code": response.status_code,
            "duration_ms": duration_ms,
            "client": request.client.host if request.client else None,
        },
    )
    response.headers["x-request-id"] = request_id
    return response
# ── Rate Limiter ─────────────────────────────────────────────────────────────
app.state.limiter = limiter
app.add_middleware(SlowAPIMiddleware)

# ── CORS ──────────────────────────────────────────────────────────────────────
# Use wildcard origins and disable credentials for maximum development compatibility.
# Since we use Bearer tokens (Authorization header) rather than cookies, 
# allow_credentials=True is NOT required.
app.add_middleware(
    CORSMiddleware,
  
    allow_origins=[
        *([config.FRONTEND_URL] if config.FRONTEND_URL else []),
        *([config.FRONTEND_URL + "/"] if config.FRONTEND_URL else []),
        "https://www.axiorapulse.com",
        "https://axiorapulse.com",
        "https://www.axiorapulse.com/",
        "https://axiorapulse.com/",
        "http://localhost:5173",
        "http://127.0.0.1:5173",
        "http://localhost:3000",
        "http://127.0.0.1:3000",
    ],
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)
@app.exception_handler(RateLimitExceeded)
def rate_limit_handler(request, exc):
    return JSONResponse(
        status_code=429,
        content={"detail": "Too many requests. Please slow down."},
    )

# ── Routers ───────────────────────────────────────────────────────────────────
app.include_router(auth_router)
app.include_router(users_router)
app.include_router(tenants_router)
app.include_router(surveys_router)
app.include_router(responses_router)
app.include_router(feedback_router)
app.include_router(dashboard_router)
app.include_router(utils_router)
app.include_router(ai_router)
app.include_router(payments_router)
app.include_router(demo_router)
app.include_router(public_router)



# ── Health ────────────────────────────────────────────────────────────────────
@app.get("/health", tags=["health"]) 
def health(): 
    try: 
        with engine.connect() as connection: 
            connection.execute( text("SELECT 1") ) 
        return { 
            "status": "healthy", 
            "service": "Nexora Pulse API", 
            "database": "connected" 
            } 
    except Exception as e: 
        return { 
            "status": "unhealthy",
            "database": "disconnected",
            "error": str(e) 
            }


@app.get("/", tags=["health"])
def root():
    return {"message": "Nexora Pulse API is running. Visit /docs for the interactive API explorer."}

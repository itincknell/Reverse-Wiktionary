"""
FastAPI application for Reverse Wiktionary serving.
"""

from __future__ import annotations

import logging
from pathlib import Path

from fastapi import FastAPI, Form, Request, Response
from fastapi.responses import HTMLResponse
from fastapi.staticfiles import StaticFiles
from fastapi.templating import Jinja2Templates

from src.common.lexical_schema import ALLOWED_POS
from src.search.encoder import QueryEncoder, QueryEncoderConfig
from src.search.qdrant_search import QdrantSearchClient, QdrantSearchConfig
from src.search.schemas import SearchRequest
from src.search.service import SearchService
from src.web.config import WebSettings, load_settings
from src.web.state import SESSION_COOKIE, ClientSearchState, RedisSessionStore


LOGGER = logging.getLogger(__name__)
PACKAGE_DIR = Path(__file__).resolve().parent


def create_app(settings: WebSettings | None = None) -> FastAPI:
    """
    Build the FastAPI application and register startup dependencies.

    Startup is intentionally strict: each worker loads its model, verifies
    Qdrant, verifies Redis, and builds the language cache before serving
    traffic.
    """
    settings = settings or load_settings()

    app = FastAPI(title="Reverse Wiktionary", version="1.0.0")
    app.state.settings = settings
    app.state.available_langs = []
    app.state.available_pos = list(ALLOWED_POS)

    templates = Jinja2Templates(directory=str(PACKAGE_DIR / "templates"))
    app.state.templates = templates

    app.mount(
        "/static",
        StaticFiles(directory=str(PACKAGE_DIR / "static")),
        name="static",
    )

    @app.on_event("startup")
    def startup() -> None:
        """
        Initialize worker-local model/search clients and shared Redis state.
        """
        encoder = QueryEncoder(
            QueryEncoderConfig(
                model_name=settings.model_name,
                device=settings.model_device,
            )
        )
        qdrant = QdrantSearchClient(
            QdrantSearchConfig(
                url=settings.qdrant_url,
                collection_name=settings.collection_name,
            )
        )
        qdrant.verify_collection()
        session_store = RedisSessionStore(
            redis_url=settings.redis_url,
            ttl_seconds=settings.session_ttl_seconds,
        )
        session_store.ping()

        app.state.encoder = encoder
        app.state.qdrant = qdrant
        app.state.search_service = SearchService(encoder=encoder, qdrant=qdrant)
        app.state.session_store = session_store
        app.state.available_langs = qdrant.available_languages()

    @app.get("/health")
    def health() -> dict[str, object]:
        """
        Check dependencies required to serve search traffic.
        """
        qdrant = app.state.qdrant
        session_store = app.state.session_store
        encoder = app.state.encoder

        qdrant.verify_collection()
        session_store.ping()

        return {
            "status": "ok",
            "app_env": settings.app_env,
            "qdrant": "ok",
            "redis": "ok",
            "collection": settings.collection_name,
            "model": "loaded" if encoder.is_loaded() else "not_loaded",
            "vector_size": encoder.embedding_dimension,
            "available_langs": len(app.state.available_langs),
            "available_pos": len(app.state.available_pos),
        }

    @app.post("/api/v1/search")
    def api_search(request: SearchRequest) -> dict[str, object]:
        """
        Stable public search API.
        """
        response = app.state.search_service.search(request)
        _log_search(response)
        return response.model_dump()

    @app.get("/", response_class=HTMLResponse)
    def index(request: Request) -> HTMLResponse:
        """
        Render the main search page with current session filter state.
        """
        session_id, should_set_cookie = _get_or_create_session_id(request)
        state = app.state.session_store.get(session_id, default_limit=settings.default_limit)

        template_response = templates.TemplateResponse(
            "index.html",
            {
                "request": request,
                "state": state,
                "available_langs": app.state.available_langs,
                "available_pos": app.state.available_pos,
                "results": [],
                "has_more": False,
            },
        )
        _set_session_cookie(template_response, session_id, settings, should_set_cookie)
        return template_response

    @app.post("/ui/search", response_class=HTMLResponse)
    def ui_search(
        request: Request,
        query: str = Form(...),
        langs: list[str] = Form(default=[]),
        pos: list[str] = Form(default=[]),
        limit: int = Form(default=settings.default_limit),
    ) -> HTMLResponse:
        """
        Execute a new UI search and replace the result pane.
        """
        session_id, should_set_cookie = _get_or_create_session_id(request)
        search_request = SearchRequest(
            query=query,
            langs=langs,
            pos=pos,
            limit=min(limit, settings.max_limit),
            offset=0,
        )
        search_response = app.state.search_service.search(search_request)
        _log_search(search_response)

        state = ClientSearchState(
            selected_langs=search_request.langs,
            selected_pos=search_request.pos,
            latest_query=search_request.query,
            limit=search_request.limit,
            next_offset=search_request.offset + search_request.limit,
            created_at_utc=app.state.session_store.get(
                session_id,
                default_limit=settings.default_limit,
            ).created_at_utc,
            updated_at_utc="",
        )
        app.state.session_store.save(session_id, state)

        template_response = templates.TemplateResponse(
            "partials/results.html",
            {
                "request": request,
                "results": search_response.results,
                "has_more": search_response.has_more,
                "next_offset": state.next_offset,
            },
        )
        _set_session_cookie(template_response, session_id, settings, should_set_cookie)
        return template_response

    @app.post("/ui/search/more", response_class=HTMLResponse)
    def ui_search_more(request: Request) -> HTMLResponse:
        """
        Append the next page for the latest session query.
        """
        session_id, should_set_cookie = _get_or_create_session_id(request)
        state = app.state.session_store.get(session_id, default_limit=settings.default_limit)

        if not state.latest_query:
            template_response = templates.TemplateResponse(
                "partials/results.html",
                {
                    "request": request,
                    "results": [],
                    "has_more": False,
                    "next_offset": 0,
                },
            )
            _set_session_cookie(template_response, session_id, settings, should_set_cookie)
            return template_response

        search_request = SearchRequest(
            query=state.latest_query,
            langs=state.selected_langs,
            pos=state.selected_pos,
            limit=state.limit,
            offset=state.next_offset,
        )
        search_response = app.state.search_service.search(search_request)
        _log_search(search_response)

        state.next_offset = search_request.offset + search_request.limit
        app.state.session_store.save(session_id, state)

        template_response = templates.TemplateResponse(
            "partials/result_items.html",
            {
                "request": request,
                "results": search_response.results,
                "has_more": search_response.has_more,
                "next_offset": state.next_offset,
            },
        )
        _set_session_cookie(template_response, session_id, settings, should_set_cookie)
        return template_response

    return app


def _get_or_create_session_id(request: Request) -> tuple[str, bool]:
    """
    Return the current session ID, creating one when no cookie is present.
    """
    session_id = request.cookies.get(SESSION_COOKIE)

    if session_id:
        return session_id, False

    session_id = request.app.state.session_store.new_session_id()
    return session_id, True


def _set_session_cookie(
    response: Response,
    session_id: str,
    settings: WebSettings,
    should_set_cookie: bool,
) -> None:
    """
    Attach the session cookie to a response when a new session was created.
    """
    if not should_set_cookie:
        return

    response.set_cookie(
        key=SESSION_COOKIE,
        value=session_id,
        max_age=settings.session_ttl_seconds,
        httponly=True,
        samesite="lax",
        secure=settings.secure_cookies,
    )


def _log_search(search_response: object) -> None:
    """
    Log aggregate request metrics without recording the raw query text.
    """
    LOGGER.info(
        "event=search query_length=%s langs_count=%s pos_count=%s limit=%s "
        "offset=%s embedding_ms=%s qdrant_ms=%s total_ms=%s result_count=%s "
        "has_more=%s",
        len(search_response.query),
        len(search_response.filters.langs),
        len(search_response.filters.pos),
        search_response.limit,
        search_response.offset,
        search_response.timing_ms.embedding,
        search_response.timing_ms.qdrant,
        search_response.timing_ms.total,
        len(search_response.results),
        search_response.has_more,
    )


app = create_app()

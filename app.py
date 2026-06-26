"""
GraphRAG POC — Knowledge Mapping
Streamlit entry point.

Run with:
    .venv/bin/streamlit run app.py
"""

import sys
import os

sys.path.insert(0, os.path.dirname(__file__))

import streamlit as st

from services import DocumentService, GraphService
from ui.components.sidebar import render_sidebar
from ui.pages import upload_page, extraction_page, graph_page, traceability_page, qa_page

# ---------------------------------------------------------------------------
# Page config
# ---------------------------------------------------------------------------

st.set_page_config(
    page_title="GraphRAG POC — Knowledge Mapping",
    page_icon="🕸️",
    layout="wide",
)

st.markdown(
    """
    <style>
    .stTabs [data-baseweb="tab-list"] { gap: 8px; }
    .stTabs [data-baseweb="tab"] { padding: 8px 20px; border-radius: 8px; background: #1e1e2e; }
    .metric-card { background: #1e1e2e; padding: 16px; border-radius: 12px; border: 1px solid #333; }
    </style>
    """,
    unsafe_allow_html=True,
)

# ---------------------------------------------------------------------------
# Session state
# ---------------------------------------------------------------------------

_DEFAULTS = {
    "uploaded_files":    [],
    "parsed_docs":       [],
    "elements":          [],
    "relationships":     [],
    "graph_built":       False,
    "coverage_results":  [],
    "chat_history":      [],
    "processing":        False,
}
for _k, _v in _DEFAULTS.items():
    if _k not in st.session_state:
        st.session_state[_k] = _v

# ---------------------------------------------------------------------------
# Cached service instances
# ---------------------------------------------------------------------------


@st.cache_resource
def get_doc_service() -> DocumentService:
    return DocumentService()


@st.cache_resource
def get_graph_service() -> GraphService:
    return GraphService()


# ---------------------------------------------------------------------------
# Sidebar
# ---------------------------------------------------------------------------

render_sidebar(get_graph_service, get_doc_service)

# ---------------------------------------------------------------------------
# Main tabs
# ---------------------------------------------------------------------------

tab1, tab2, tab3, tab4, tab5 = st.tabs(
    [
        "📁 Step 1: Upload",
        "🔬 Step 2: Extract",
        "🕸️ Step 3: Graph",
        "📊 Step 4: Traceability",
        "💬 Step 5: Ask",
    ]
)

with tab1:
    upload_page.render(get_doc_service)

with tab2:
    extraction_page.render(get_doc_service)

with tab3:
    graph_page.render(get_graph_service)

with tab4:
    traceability_page.render(get_graph_service)

with tab5:
    qa_page.render(get_graph_service)

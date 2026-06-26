"""Sidebar component — infrastructure status and session controls."""

import streamlit as st


def _clear_ui_state() -> None:
    """Reset only Streamlit session state — Neo4j and Qdrant are untouched."""
    for key in [
        "uploaded_files", "parsed_docs", "elements",
        "relationships", "coverage_results", "chat_history",
        "doc_hashes",
    ]:
        st.session_state[key] = []
    st.session_state["graph_built"] = False


def render_sidebar(get_graph_service, get_doc_service) -> None:
    with st.sidebar:
        st.title("🕸️ GraphRAG POC")
        st.markdown("---")

        # ── Infrastructure status ──────────────────────────────────────────
        st.markdown("### Infrastructure Status")

        node_count = 0
        try:
            gs = get_graph_service()
            node_count = gs.get_node_count()
            st.success(f"✅ Neo4j connected ({node_count} nodes)")
        except Exception as e:
            st.error(f"❌ Neo4j: {str(e)[:60]}")

        try:
            from qdrant_client import QdrantClient
            from config.settings import settings
            qc = QdrantClient(host=settings.qdrant_host, port=settings.qdrant_port)
            qc.get_collections()
            st.success("✅ Qdrant connected")
        except Exception as e:
            st.error(f"❌ Qdrant: {str(e)[:60]}")

        st.markdown("---")

        # ── Load from existing graph ───────────────────────────────────────
        # Show when DB has data but the session is empty (e.g. after restart)
        session_empty = not st.session_state.get("elements")
        if node_count > 0 and session_empty:
            st.markdown("### Existing Graph Detected")
            st.info(
                f"Neo4j already contains **{node_count} nodes**. "
                "You don't need to re-upload files."
            )
            if st.button("📂 Load from Graph", type="primary"):
                with st.spinner("Restoring session from Neo4j…"):
                    try:
                        elements, coverage = get_graph_service().load_existing_data()
                        st.session_state["elements"]         = elements
                        st.session_state["coverage_results"] = coverage
                        st.session_state["graph_built"]      = True
                        st.session_state["chat_history"]     = []
                        st.rerun()
                    except Exception as exc:
                        st.error(f"Load failed: {exc}")
            st.markdown("---")

        # ── Session summary ────────────────────────────────────────────────
        st.markdown("### Session")

        if st.session_state.get("elements"):
            st.info(f"📊 {len(st.session_state.elements)} elements extracted")
        if st.session_state.get("relationships"):
            st.info(f"🔗 {len(st.session_state.relationships)} relationships")
        if st.session_state.get("graph_built"):
            st.info("🕸️ Graph built")

        st.markdown("---")

        # ── Reset controls ─────────────────────────────────────────────────
        st.markdown("### Reset")

        if st.button("🔄 Clear UI State", type="secondary", help=(
            "Clears the current session (elements, relationships, Q&A history) "
            "without touching Neo4j or Qdrant. Your ingested graph is preserved."
        )):
            _clear_ui_state()
            st.rerun()

        # Wipe Database — destructive, requires confirmation
        if st.button("🗑️ Wipe Database", type="secondary", help=(
            "Permanently deletes all data from Neo4j and Qdrant. "
            "You will need to re-upload and re-process all documents."
        )):
            st.session_state["_confirm_wipe"] = True

        if st.session_state.get("_confirm_wipe"):
            st.warning("⚠️ This will permanently delete all graph data.")
            col_yes, col_no = st.columns(2)
            with col_yes:
                if st.button("✅ Confirm", type="primary"):
                    try:
                        get_graph_service().reset_graph()
                        st.success("Database wiped.")
                    except Exception as exc:
                        st.error(f"Wipe failed: {exc}")
                    _clear_ui_state()
                    st.session_state.pop("_confirm_wipe", None)
                    st.rerun()
            with col_no:
                if st.button("❌ Cancel"):
                    st.session_state.pop("_confirm_wipe", None)
                    st.rerun()

        st.markdown("---")
        st.caption("GPT-4o · Neo4j · Qdrant · Graphiti · BGE-M3")

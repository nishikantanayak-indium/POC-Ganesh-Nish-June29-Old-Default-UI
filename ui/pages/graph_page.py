"""Step 3 — Knowledge Graph Visualization page."""

import streamlit as st
import streamlit.components.v1 as components


def _render_build_prompt(get_graph_service) -> None:
    st.markdown(
        "Build the knowledge graph in **Neo4j**, index semantic vectors in **Qdrant**, "
        "and ingest document episodes into **Graphiti**."
    )
    if st.button("🕸️ Build Knowledge Graph", type="primary"):
        with st.spinner(
            "Building graph in Neo4j · Indexing in Qdrant · Ingesting into Graphiti…"
        ):
            try:
                gs = get_graph_service()
                gs.build_knowledge_graph(
                    st.session_state["parsed_docs"],
                    st.session_state["elements"],
                    st.session_state.get("relationships", []),
                )
                st.session_state["coverage_results"] = gs.get_coverage_results()
                st.session_state["graph_built"] = True
                st.success(
                    f"✅ Graph built — "
                    f"{gs.get_node_count()} nodes · {gs.get_edge_count()} edges"
                )
                st.rerun()
            except Exception as exc:
                st.error(f"Graph build failed: {exc}")
                st.exception(exc)


def _render_graph_viewer(get_graph_service) -> None:
    gs = get_graph_service()

    # ── Stats row ──────────────────────────────────────────────────────────
    c1, c2, c3 = st.columns(3)
    c1.metric("📦 Nodes",    gs.get_node_count())
    c2.metric("🔗 Edges",    gs.get_edge_count())
    c3.metric("📋 Elements", len(st.session_state.get("elements", [])))

    st.markdown("---")

    # ── Full graph ─────────────────────────────────────────────────────────
    show_contains = st.checkbox(
        "Show CONTAINS edges (document → element links)", value=False
    )
    try:
        html = gs.get_visualization_html(show_contains=show_contains)
        components.html(html, height=650, scrolling=False)
    except Exception as exc:
        st.error(f"Visualization failed: {exc}")

    # ── Subgraph explorer ──────────────────────────────────────────────────
    st.markdown("---")
    st.subheader("Subgraph Explorer")
    st.caption(
        "Enter any node ID (e.g. REQ_001, RISK_002) to see its immediate neighborhood."
    )

    col_input, col_btn = st.columns([3, 1])
    with col_input:
        node_id = st.text_input(
            "Node ID", placeholder="REQ_001", label_visibility="collapsed"
        )
    with col_btn:
        explore = st.button("Explore", type="secondary")

    if node_id and explore:
        try:
            sub_html = gs.get_subgraph_html(node_id)
            components.html(sub_html, height=520, scrolling=False)
        except Exception as exc:
            st.error(f"Subgraph failed: {exc}")


def render(get_graph_service) -> None:
    st.header("Knowledge Graph")

    if not st.session_state.get("elements"):
        st.info("👆 Extract elements first (Step 2).")
        return

    if not st.session_state.get("graph_built"):
        _render_build_prompt(get_graph_service)
    else:
        _render_graph_viewer(get_graph_service)

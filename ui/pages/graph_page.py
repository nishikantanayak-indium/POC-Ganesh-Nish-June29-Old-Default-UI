"""Step 3 — Knowledge Graph Visualization page."""

import base64

import streamlit as st


def _html_to_iframe_src(html: str) -> str:
    """Base64-encode a full HTML document for use as a data: URL in st.iframe."""
    b64 = base64.b64encode(html.encode("utf-8")).decode()
    return f"data:text/html;base64,{b64}"


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
                    doc_hashes=st.session_state.get("doc_hashes"),
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
        st.iframe(_html_to_iframe_src(html), height=680)
    except Exception as exc:
        st.error(f"Visualization failed: {exc}")

    # ── Subgraph explorer ──────────────────────────────────────────────────
    st.markdown("---")
    st.subheader("Subgraph Explorer")
    st.caption(
        "Enter any node ID (e.g. REQ_956377, RISK_2AB1C4) to see its immediate neighborhood."
    )

    col_input, col_btn = st.columns([3, 1])
    with col_input:
        node_id = st.text_input(
            "Node ID", placeholder="REQ_956377", label_visibility="collapsed"
        )
    with col_btn:
        explore = st.button("Explore", type="secondary")

    if node_id and explore:
        try:
            sub_html = gs.get_subgraph_html(node_id)
            st.iframe(_html_to_iframe_src(sub_html), height=550)
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

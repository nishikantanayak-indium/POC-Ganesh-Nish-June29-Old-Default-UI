"""Step 2 — Extracted Elements & Relationships page."""

from collections import Counter

import pandas as pd
import streamlit as st


_TYPE_ICONS = {
    "Requirement": "📋",
    "Clause":      "📄",
    "Risk":        "⚠️",
    "Mitigation":  "🛡️",
    "LD":          "💰",
}


def _render_elements_table(elements: list) -> None:
    """Filterable, paginated elements dataframe."""
    col_type, col_doc = st.columns([2, 1])
    with col_type:
        type_filter = st.multiselect(
            "Filter by type",
            options=["Requirement", "Clause", "Risk", "Mitigation", "LD"],
            default=["Requirement", "Clause", "Risk", "Mitigation", "LD"],
            key="elem_type_filter",
        )
    with col_doc:
        doc_ids = list({e.document_id for e in elements})
        doc_filter = st.multiselect(
            "Filter by document", options=doc_ids, key="elem_doc_filter"
        )

    filtered = [e for e in elements if e.type.value in type_filter]
    if doc_filter:
        filtered = [e for e in filtered if e.document_id in doc_filter]

    df = pd.DataFrame(
        [
            {
                "ID":         e.id,
                "Type":       e.type.value,
                "Text":       e.text[:120] + ("…" if len(e.text) > 120 else ""),
                "Source":     e.source,
                "Confidence": e.confidence,
                "Document":   e.document_id,
            }
            for e in filtered
        ]
    )
    st.dataframe(
        df,
        use_container_width=True,
        hide_index=True,
        column_config={
            "Confidence": st.column_config.ProgressColumn(
                "Confidence", min_value=0, max_value=1, format="%.2f"
            )
        },
    )
    st.caption(f"Showing {len(filtered)} of {len(elements)} elements")


def _render_relationships_section(get_doc_service, elements: list) -> None:
    st.subheader("Cross-Document Relationships")

    if st.session_state.get("relationships"):
        rels = st.session_state["relationships"]
        st.success(f"✅ {len(rels)} relationships extracted")
        rel_df = pd.DataFrame(
            [
                {
                    "Source":       r.source_id,
                    "Relationship": r.type.value,
                    "Target":       r.target_id,
                    "Confidence":   f"{r.confidence:.2f}",
                    "Evidence":     r.evidence[:100],
                }
                for r in rels
            ]
        )
        st.dataframe(rel_df, use_container_width=True, hide_index=True)

    if st.button("🔗 Extract Cross-Document Relationships", type="primary"):
        with st.spinner("Inferring relationships with GPT-4o…"):
            try:
                rels = get_doc_service().extract_cross_document_relationships(elements)
                st.session_state["relationships"] = rels
                st.success(f"✅ Found {len(rels)} relationships!")
                st.rerun()
            except Exception as exc:
                st.error(f"Relationship extraction failed: {exc}")


def render(get_doc_service) -> None:
    st.header("Extracted Atomic Elements")

    elements = st.session_state.get("elements", [])
    if not elements:
        st.info("👆 Upload and process documents in Step 1 first.")
        return

    # ── Summary metrics ────────────────────────────────────────────────────
    counts = Counter(e.type.value for e in elements)
    metric_cols = st.columns(5)
    for i, etype in enumerate(["Requirement", "Clause", "Risk", "Mitigation", "LD"]):
        metric_cols[i].metric(
            f"{_TYPE_ICONS.get(etype, '')} {etype}s",
            counts.get(etype, 0),
        )

    st.markdown("---")
    _render_elements_table(elements)
    st.markdown("---")
    _render_relationships_section(get_doc_service, elements)

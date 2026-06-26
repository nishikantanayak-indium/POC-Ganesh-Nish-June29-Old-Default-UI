"""Step 4 — Inter-Document Traceability page."""

import pandas as pd
import streamlit as st
from core.models import CoverageStatus


_STATUS_ICONS = {
    CoverageStatus.COVERED:     "✅ Covered",
    CoverageStatus.PARTIAL:     "⚠️ Partial",
    CoverageStatus.NOT_COVERED: "❌ Not Covered",
}


def _render_summary(results: list) -> float:
    covered     = sum(1 for r in results if r.status == CoverageStatus.COVERED)
    partial     = sum(1 for r in results if r.status == CoverageStatus.PARTIAL)
    not_covered = sum(1 for r in results if r.status == CoverageStatus.NOT_COVERED)
    total       = len(results)

    c1, c2, c3, c4 = st.columns(4)
    c1.metric("Total Requirements",   total)
    c2.metric("✅ Covered",            covered)
    c3.metric("⚠️ Partially Covered", partial)
    c4.metric("❌ Not Covered",        not_covered)

    pct = (covered + partial * 0.5) / total if total else 0
    st.progress(pct, text=f"Coverage score: {pct * 100:.0f}%")
    return pct


def _render_coverage_table(results: list) -> None:
    df = pd.DataFrame(
        [
            {
                "Req ID":           r.requirement_id,
                "Requirement":      r.requirement_text[:100]
                                    + ("…" if len(r.requirement_text) > 100 else ""),
                "Status":           _STATUS_ICONS.get(r.status, r.status.value),
                "Covering Clauses": ", ".join(r.covering_clauses) or "—",
                "Risks":            ", ".join(r.risks) or "—",
                "Mitigations":      ", ".join(r.mitigations) or "—",
                "LDs":              ", ".join(r.lds) or "—",
                "Source":           r.source,
            }
            for r in results
        ]
    )
    st.dataframe(df, width="stretch", hide_index=True)


def _render_chain_detail(get_graph_service, results: list) -> None:
    st.subheader("Traceability Chain Detail")

    req_ids      = [r.requirement_id for r in results]
    selected_req = st.selectbox("Select a requirement:", req_ids, key="trace_req_sel")
    if not selected_req:
        return

    try:
        chain = get_graph_service().get_traceability(selected_req)
    except Exception as exc:
        st.error(f"Traceability lookup failed: {exc}")
        return

    if not chain:
        st.warning("No traceability data found for this requirement.")
        return

    with st.expander(f"Full chain for {selected_req}", expanded=True):
        left, right = st.columns(2)

        with left:
            req_data = chain.get("requirement", {})
            st.markdown("**Requirement text**")
            st.info(
                req_data.get("text", "—")
                + f"\n\n*Source: {req_data.get('source', '—')}*"
            )
            st.markdown(
                "**Full coverage by:** "
                + (", ".join(chain.get("full_coverage", [])) or "None")
            )
            st.markdown(
                "**Partial coverage by:** "
                + (", ".join(chain.get("partial_coverage", [])) or "None")
            )

        with right:
            st.markdown(
                "**Risks introduced:** "
                + (", ".join(chain.get("risks", [])) or "None")
            )
            st.markdown(
                "**Mitigations:** "
                + (", ".join(chain.get("mitigations", [])) or "None")
            )
            st.markdown(
                "**Liquidated Damages:** "
                + (", ".join(chain.get("lds", [])) or "None")
            )

        gaps = chain.get("gaps", [])
        if gaps:
            st.warning("**Gaps identified:**\n" + "\n".join(f"- {g}" for g in gaps))
        else:
            st.success("No gaps detected for this requirement.")


def render(get_graph_service) -> None:
    st.header("Inter-Document Traceability")

    results = st.session_state.get("coverage_results", [])
    if not results:
        st.info("👆 Build the knowledge graph first (Step 3).")
        return

    _render_summary(results)
    st.markdown("---")
    _render_coverage_table(results)
    st.markdown("---")
    _render_chain_detail(get_graph_service, results)

"""Step 5 — Natural Language Q&A page."""

import pandas as pd
import streamlit as st
from services import QAService


_PRESETS = [
    "Which RFP requirements are not covered in the contract?",
    "Show risks linked to partially covered requirements.",
    "Which requirements have no mitigation?",
    "Which risks have no Liquidated Damages?",
]


def _render_preset_buttons() -> None:
    st.markdown("**Quick questions:**")
    cols = st.columns(2)
    for i, preset in enumerate(_PRESETS):
        if cols[i % 2].button(preset, key=f"qa_preset_{i}"):
            st.session_state["current_question"] = preset


def _render_answer(item: dict) -> None:
    st.markdown(f"**Q: {item['question']}**")
    st.success(item["result"]["answer"])

    evidence = item["result"].get("evidence", [])
    query_type = item["result"].get("query_type", "—")
    with st.expander(
        f"Evidence · query type: `{query_type}` · {len(evidence)} item(s)"
    ):
        if evidence:
            st.dataframe(pd.DataFrame(evidence), use_container_width=True)
        else:
            st.write("No evidence items returned.")
    st.markdown("---")


def render(get_graph_service) -> None:
    st.header("Ask Questions")

    if not st.session_state.get("graph_built"):
        st.info("👆 Build the knowledge graph first (Step 3).")
        return

    _render_preset_buttons()
    st.markdown("---")

    question = st.text_input(
        "Or type your own question:",
        value=st.session_state.get("current_question", ""),
        placeholder="e.g. Which RFP requirements are not covered in the contract?",
        key="qa_question_input",
    )

    if st.button("🔍 Ask", type="primary") and question:
        with st.spinner("Querying graph and generating answer…"):
            try:
                gs = get_graph_service()
                qa = QAService(gs.store, gs.builder, gs.graphiti, gs.vector_store)
                result = qa.answer(question)
                st.session_state["chat_history"].insert(
                    0, {"question": question, "result": result}
                )
                st.session_state.pop("current_question", None)
            except Exception as exc:
                st.error(f"Q&A failed: {exc}")
                st.exception(exc)

    # ── Chat history ───────────────────────────────────────────────────────
    for item in st.session_state.get("chat_history", []):
        _render_answer(item)

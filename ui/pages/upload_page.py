"""Step 1 — Upload Documents page."""

from collections import Counter

import pandas as pd
import streamlit as st


def _detect_doc_type(filename: str) -> str:
    name = filename.lower()
    if any(w in name for w in ["rfp", "rfx", "tender"]):
        return "🟢 RFP"
    if any(w in name for w in ["risk", "rmc", "register"]):
        return "🔴 Risk Sheet"
    if any(w in name for w in ["contract", "offer", "agreement", "purchase"]):
        return "🟠 Contract"
    return "❓ Unknown"


def render(get_doc_service) -> None:
    st.header("Upload Documents")
    st.markdown(
        "Upload your **RFP**, **Risk Sheet**, and **Contract** documents (PDF or DOCX). "
        "The system will extract typed atomic elements from each file using GPT-4o."
    )

    col_upload, col_info = st.columns([2, 1])

    with col_upload:
        uploaded = st.file_uploader(
            "Drop files here",
            type=["pdf", "docx"],
            accept_multiple_files=True,
            label_visibility="collapsed",
        )

    if not uploaded:
        st.info("👆 Upload at least one PDF or DOCX file to get started.")
        return

    # ── File summary table ─────────────────────────────────────────────────
    rows = [
        {
            "Filename":      f.name,
            "Detected Type": _detect_doc_type(f.name),
            "Format":        f.name.rsplit(".", 1)[-1].upper(),
            "Size":          f"{f.size / 1024:.1f} KB",
        }
        for f in uploaded
    ]
    st.dataframe(pd.DataFrame(rows), use_container_width=True, hide_index=True)

    with col_info:
        st.markdown("### Ready")
        st.info(f"{len(uploaded)} file(s) selected")
        st.markdown(
            "**Tip:** name files with keywords like `rfp`, `risk`, "
            "`contract` for automatic type detection."
        )

    # ── Process button ─────────────────────────────────────────────────────
    if st.button(
        "🚀 Process Documents",
        type="primary",
        disabled=st.session_state.get("processing", False),
    ):
        st.session_state["processing"] = True
        # Read all bytes eagerly — UploadedFile is not seekable after rerun
        file_list = [(f.read(), f.name) for f in uploaded]

        with st.spinner("Parsing documents and extracting elements with GPT-4o…"):
            try:
                ds = get_doc_service()
                docs, elements = ds.process_files(file_list)

                st.session_state["parsed_docs"]      = docs
                st.session_state["elements"]         = elements
                st.session_state["relationships"]    = []
                st.session_state["graph_built"]      = False
                st.session_state["coverage_results"] = []

                st.success(
                    f"✅ Extracted **{len(elements)}** atomic elements "
                    f"from **{len(docs)}** document(s)."
                )

                counts = Counter(e.type.value for e in elements)
                type_icons = {
                    "Requirement": "📋", "Clause": "📄",
                    "Risk": "⚠️", "Mitigation": "🛡️", "LD": "💰",
                }
                metric_cols = st.columns(max(len(counts), 1))
                for i, (t, c) in enumerate(counts.items()):
                    metric_cols[i].metric(f"{type_icons.get(t, '')} {t}s", c)

            except Exception as exc:
                st.error(f"Processing failed: {exc}")
                st.exception(exc)

        st.session_state["processing"] = False

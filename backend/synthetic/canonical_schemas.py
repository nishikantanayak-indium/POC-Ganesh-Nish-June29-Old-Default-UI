from core.models import DocumentType

RFP_SCHEMA = [
    {"heading": "Cover Page", "format_type": "paragraph", "mandatory": True},
    {"heading": "Document Control", "format_type": "paragraph", "mandatory": True},
    {"heading": "Table of Contents", "format_type": "paragraph", "mandatory": True},
    {"heading": "Introduction and Background", "format_type": "paragraph", "mandatory": True},
    {"heading": "Business Objectives", "format_type": "paragraph", "mandatory": True},
    {"heading": "Project Overview", "format_type": "paragraph", "mandatory": True},
    {"heading": "Definitions and Glossary", "format_type": "hybrid", "mandatory": True},
    {"heading": "Scope of Work", "format_type": "hybrid", "mandatory": True},
    {"heading": "Functional Requirements", "format_type": "hybrid", "mandatory": True},
    {"heading": "Technical Requirements", "format_type": "hybrid", "mandatory": True},
    {"heading": "Non-Functional Requirements", "format_type": "hybrid", "mandatory": True},
    {"heading": "Deliverables", "format_type": "table", "mandatory": True},
    {"heading": "Procurement Timeline", "format_type": "table", "mandatory": True},
    {"heading": "Implementation Timeline", "format_type": "table", "mandatory": True},
    {"heading": "Vendor Eligibility and Qualification Criteria", "format_type": "hybrid", "mandatory": True},
    {"heading": "Point of Contact and Communication Protocol", "format_type": "paragraph", "mandatory": True},
    {"heading": "Pre-Bid Query and Clarification Process", "format_type": "paragraph", "mandatory": True},
    {"heading": "Proposal Submission Instructions", "format_type": "paragraph", "mandatory": True},
    {"heading": "Proposal Response Format", "format_type": "table", "mandatory": True},
    {"heading": "Evaluation Criteria and Scoring Methodology", "format_type": "table", "mandatory": True},
    {"heading": "Commercial/Pricing Requirements", "format_type": "table", "mandatory": True},
    {"heading": "Legal, Compliance, and Regulatory Requirements", "format_type": "hybrid", "mandatory": True},
    {"heading": "Confidentiality and Data Protection Requirements", "format_type": "hybrid", "mandatory": True},
    {"heading": "Service Level Expectations", "format_type": "table", "mandatory": True},
    {"heading": "Governance and Reporting", "format_type": "paragraph", "mandatory": True},
    {"heading": "Assumptions, Dependencies, Constraints, and Open Items", "format_type": "paragraph", "mandatory": True},
    {"heading": "Terms and Conditions", "format_type": "numbered_clause", "mandatory": True},
    {"heading": "Disclaimer and Reservation of Rights", "format_type": "paragraph", "mandatory": True},
    {"heading": "Appendices", "format_type": "paragraph", "mandatory": True},
]

CONTRACT_SCHEMA = [
    {"heading": "Cover Page", "format_type": "paragraph", "mandatory": True},
    {"heading": "Table of Contents", "format_type": "paragraph", "mandatory": True},
    {"heading": "Contract Summary", "format_type": "table", "mandatory": True},
    {"heading": "Parties to the Agreement", "format_type": "paragraph", "mandatory": True},
    {"heading": "Recitals / Background", "format_type": "paragraph", "mandatory": True},
    {"heading": "Definitions", "format_type": "numbered_clause", "mandatory": True},
    {"heading": "Order of Precedence", "format_type": "numbered_clause", "mandatory": True},
    {"heading": "Scope of Services", "format_type": "hybrid", "mandatory": True},
    {"heading": "Deliverables and Acceptance Criteria", "format_type": "table", "mandatory": True},
    {"heading": "Roles and Responsibilities", "format_type": "hybrid", "mandatory": True},
    {"heading": "Project Timeline and Milestones", "format_type": "table", "mandatory": True},
    {"heading": "Fees, Payment Terms, and Invoicing", "format_type": "hybrid", "mandatory": True},
    {"heading": "Change Request Procedure", "format_type": "hybrid", "mandatory": True},
    {"heading": "Service Levels and Performance Standards", "format_type": "table", "mandatory": True},
    {"heading": "Governance and Reporting", "format_type": "hybrid", "mandatory": True},
    {"heading": "Vendor Personnel and Subcontracting", "format_type": "numbered_clause", "mandatory": True},
    {"heading": "Confidentiality", "format_type": "numbered_clause", "mandatory": True},
    {"heading": "Data Protection and Information Security", "format_type": "numbered_clause", "mandatory": True},
    {"heading": "Intellectual Property Rights", "format_type": "numbered_clause", "mandatory": True},
    {"heading": "Compliance with Laws", "format_type": "numbered_clause", "mandatory": True},
    {"heading": "Representations and Warranties", "format_type": "numbered_clause", "mandatory": True},
    {"heading": "Indemnity", "format_type": "numbered_clause", "mandatory": True},
    {"heading": "Limitation of Liability", "format_type": "numbered_clause", "mandatory": True},
    {"heading": "Insurance", "format_type": "numbered_clause", "mandatory": True},
    {"heading": "Audit Rights", "format_type": "numbered_clause", "mandatory": True},
    {"heading": "Term and Termination", "format_type": "hybrid", "mandatory": True},
    {"heading": "Transition Assistance / Exit Management", "format_type": "numbered_clause", "mandatory": True},
    {"heading": "Dispute Resolution", "format_type": "numbered_clause", "mandatory": True},
    {"heading": "Force Majeure", "format_type": "numbered_clause", "mandatory": True},
    {"heading": "Notices", "format_type": "numbered_clause", "mandatory": True},
    {"heading": "Assignment", "format_type": "numbered_clause", "mandatory": True},
    {"heading": "Governing Law and Jurisdiction", "format_type": "numbered_clause", "mandatory": True},
    {"heading": "Entire Agreement", "format_type": "numbered_clause", "mandatory": True},
    {"heading": "General / Miscellaneous Provisions", "format_type": "numbered_clause", "mandatory": True},
    {"heading": "Signatures", "format_type": "paragraph", "mandatory": True},
    {"heading": "Schedules and Annexures", "format_type": "table", "mandatory": True},
    {"heading": "Open Items / Conditions Precedent to Execution", "format_type": "paragraph", "mandatory": True},
]

RISK_SHEET_SCHEMA = [
    {"heading": "Risk Sheet Summary", "format_type": "hybrid", "mandatory": True},
    {"heading": "Risk Assessment Methodology", "format_type": "paragraph", "mandatory": True},
    {"heading": "Risk Scoring Matrix", "format_type": "table", "mandatory": True},
    {"heading": "Risk Register", "format_type": "table", "mandatory": True},
    {"heading": "Key High-Risk Items", "format_type": "hybrid", "mandatory": True},
    {"heading": "Mitigation Plan", "format_type": "hybrid", "mandatory": True},
    {"heading": "Ownership and Monitoring", "format_type": "hybrid", "mandatory": True},
    {"heading": "Assumptions and Open Items", "format_type": "paragraph", "mandatory": True},
]

# --- Compact schemas for shorter outputs ---

COMPACT_RFP_SCHEMA = [
    {"heading": "Cover Page", "format_type": "paragraph", "mandatory": True},
    {"heading": "Background and Business Objectives", "format_type": "paragraph", "mandatory": True},
    {"heading": "Project Scope", "format_type": "paragraph", "mandatory": True},
    {"heading": "Key Functional and Technical Requirements", "format_type": "hybrid", "mandatory": True},
    {"heading": "Deliverables and Timeline", "format_type": "table", "mandatory": True},
    {"heading": "Vendor Qualification Criteria", "format_type": "hybrid", "mandatory": True},
    {"heading": "Proposal Submission and Response Format", "format_type": "table", "mandatory": True},
    {"heading": "Evaluation Criteria", "format_type": "table", "mandatory": True},
    {"heading": "Pricing Requirements", "format_type": "table", "mandatory": True},
    {"heading": "Compliance, Security, and Service Levels", "format_type": "hybrid", "mandatory": True},
    {"heading": "Assumptions and Open Items", "format_type": "paragraph", "mandatory": True},
    {"heading": "Terms and Conditions", "format_type": "numbered_clause", "mandatory": True},
]

COMPACT_CONTRACT_SCHEMA = [
    {"heading": "Cover Page", "format_type": "paragraph", "mandatory": True},
    {"heading": "Parties to the Agreement", "format_type": "paragraph", "mandatory": True},
    {"heading": "Recitals / Background", "format_type": "paragraph", "mandatory": True},
    {"heading": "Definitions", "format_type": "numbered_clause", "mandatory": True},
    {"heading": "Scope of Services", "format_type": "hybrid", "mandatory": True},
    {"heading": "Deliverables and Acceptance Criteria", "format_type": "table", "mandatory": True},
    {"heading": "Project Timeline and Milestones", "format_type": "table", "mandatory": True},
    {"heading": "Fees, Payment Terms, and Invoicing", "format_type": "hybrid", "mandatory": True},
    {"heading": "Data Protection, Compliance, and Security", "format_type": "numbered_clause", "mandatory": True},
    {"heading": "Intellectual Property Rights", "format_type": "numbered_clause", "mandatory": True},
    {"heading": "Representations, Warranties, Indemnity, and Liability", "format_type": "numbered_clause", "mandatory": True},
    {"heading": "Term and Termination", "format_type": "hybrid", "mandatory": True},
    {"heading": "Governing Law and Dispute Resolution", "format_type": "numbered_clause", "mandatory": True},
    {"heading": "Signatures", "format_type": "paragraph", "mandatory": True},
    {"heading": "Schedules, Annexures, and Open Items", "format_type": "table", "mandatory": True},
]

COMPACT_RISK_SHEET_SCHEMA = [
    {"heading": "Risk Sheet Summary", "format_type": "hybrid", "mandatory": True},
    {"heading": "Risk Scoring Matrix", "format_type": "table", "mandatory": True},
    {"heading": "Risk Register", "format_type": "table", "mandatory": True},
    {"heading": "Mitigation Plan", "format_type": "hybrid", "mandatory": True},
    {"heading": "Assumptions and Open Items", "format_type": "paragraph", "mandatory": True},
]

COMPACT_RISK_COLUMNS = [
    "Risk ID", "Category", "Risk Description", "Likelihood", "Impact", "Score", "Rating", "Owner", "Mitigation", "Status"
]

EXTENDED_RISK_COLUMNS = [
    "Risk ID", "Category", "Risk Description", "Likelihood", "Impact", "Score", "Rating", "Owner", "Mitigation", "Status",
    "Source Reference", "Cause", "Potential Impact", "Contingency Plan", "Due Date", "Comments"
]

def get_canonical_schema(doc_type: DocumentType, length_mode: str = "extended") -> list:
    if length_mode == "compact":
        if doc_type == DocumentType.RFP:
            return COMPACT_RFP_SCHEMA
        elif doc_type == DocumentType.CONTRACT:
            return COMPACT_CONTRACT_SCHEMA
        elif doc_type == DocumentType.RISK_SHEET:
            return COMPACT_RISK_SHEET_SCHEMA

    if doc_type == DocumentType.RFP:
        return RFP_SCHEMA
    elif doc_type == DocumentType.CONTRACT:
        return CONTRACT_SCHEMA
    elif doc_type == DocumentType.RISK_SHEET:
        return RISK_SHEET_SCHEMA
    
    raise ValueError(f"No canonical schema defined for {doc_type.value}/{length_mode}")

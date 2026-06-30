# Q&A Test Questions — Cloud Services Procurement Workspace

Generated from real document content:
- `contract_msa_cloud_services.docx` — MSA-2024-INFRA-007 (Acme Corporation ↔ CloudPro Solutions Ltd)
- `rfp_acme_cloud_services.docx` — RFP-2024-INFRA-007 (issued 2024-01-15, closed 2024-03-01)
- `risk_rmc_cloud_services.docx` — Risk & Mitigation Register v1.3

---

## `summary` intent

1. Give me an overall summary of the coverage status across all three documents.
2. How many requirements are covered, partially covered, and not covered in this workspace?
3. How many risks have been mitigated, and how many are still unmitigated?

---

## `coverage_gap` intent

4. The RFP requires 99.9% availability (REQ-001) but the contract only commits to 99.5% (CL-002) — is this gap addressed anywhere?
5. REQ-002 demands a 30-minute RPO, but the contract specifies a 1-hour RPO (CL-013). Which requirements are not covered by the contract clauses?
6. The RFP requires SOC 2 Type II compliance (REQ-005) in addition to ISO 27001 — does the contract cover this requirement?
7. REQ-006 mandates quarterly CREST-certified penetration testing with 15-business-day remediation reports. Is this requirement covered in the MSA?

---

## `no_mitigation` intent

8. Which risks in the risk register do not have an associated mitigation plan?
9. RISK-004 is about performance degradation — does it have a mitigation that addresses the 90-second auto-scaling trigger?
10. Are there any high-score risks (above 12/25) that lack documented mitigations?

---

## `no_ld` intent

11. RISK-005 covers compliance failure (loss of ISO 27001 or SOC 2) — does it have a liquidated damages clause or is it treated as a material breach?
12. Which risks in the register have no LD clause attached?
13. Is there a financial penalty defined if CloudPro Solutions fails the CREST penetration testing remediation deadline?

---

## `comparison` intent

14. Compare the incident response SLAs in the RFP against what was agreed in the contract — did Acme accept weaker terms?
15. The RFP required TLS 1.3 (REQ-004) but the contract specifies TLS 1.2 or higher (CL-004). Compare the encryption requirements across documents.
16. Compare the auto-scaling performance requirements: the RFP asked for 90-second triggers at 70% CPU (REQ-008) — what did the contract commit to?
17. How does the availability penalty in the contract (CL-014: 1.5% per 0.1% shortfall, max 15%) compare to the risk register's LD-001 (2% per 0.1%, max 20%)?

---

## `general` intent

18. What is the data breach indemnification cap under the MSA for CloudPro Solutions?
    > Expected: £500,000 per incident (CL-015)

19. What is the liquidated damages rate if Tier-1 systems exceed the 2-hour RTO during a disaster recovery failure?
    > Expected: £25,000 per system per hour, maximum £200,000 per incident (LD-003)

20. When must CloudPro provide monthly service reports after month-end?
    > Expected: Within 5 business days (CL-012)

21. What encryption standard is required for data at rest and in transit?
    > Expected: AES-256 at rest; TLS 1.2+ in contract (CL-004), TLS 1.3+ in RFP (REQ-004)

22. What triggers automatic service credits for availability shortfalls, and how are they applied?
    > Expected: CL-014 — credits applied automatically to the following month's invoice

---

## Key Cross-Document Gaps (Discrepancies to Verify)

| Topic | RFP Requirement | Contract Commitment | Gap |
|-------|----------------|---------------------|-----|
| Availability SLA | 99.9% (REQ-001) | 99.5% (CL-002) | 0.4% weaker |
| RPO | 30 min (REQ-002) | 1 hour (CL-013) | 2× weaker |
| TLS version | 1.3+ (REQ-004) | 1.2+ (CL-004) | Downgraded |
| Priority-1 response | 15 min (REQ-009) | 30 min (CL-003) | 2× weaker |
| Pen test cadence | Quarterly (REQ-006) | Not specified (CL-006) | Gap |
| SOC 2 Type II | Required (REQ-005) | Not mentioned (CL-005) | Gap |

These discrepancies are the most valuable test cases — a well-functioning comparison and coverage_gap intent should surface all six.

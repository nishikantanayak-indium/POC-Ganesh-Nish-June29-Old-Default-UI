"""
Exception hierarchy for the GraphRAG POC application.

All application-specific exceptions inherit from :class:`GraphRAGError` so
callers can catch the entire family with a single ``except GraphRAGError``
clause, or target a specific sub-type for finer-grained handling.

Usage example::

    from core.exceptions import ParseError, UnsupportedFileTypeError

    try:
        doc = parser.parse(file, filename)
    except UnsupportedFileTypeError as exc:
        # Surface a clean user-facing message
        raise HTTPException(status_code=415, detail=str(exc)) from exc
    except ParseError as exc:
        logger.error("Parsing failed: %s", exc)
        raise
"""


class GraphRAGError(Exception):
    """
    Root exception for all application-level errors.

    Catching this class will catch every exception defined in this module.
    """


class ParseError(GraphRAGError):
    """
    Raised when a document cannot be parsed.

    This is the base class for all parsing-related errors.  Use the more
    specific :class:`UnsupportedFileTypeError` when the file extension is
    the root cause.
    """


class ExtractionError(GraphRAGError):
    """
    Raised when element or relationship extraction fails.

    Common causes:
    - LLM API call timeout or rate-limit
    - Malformed JSON in the LLM response
    - Response schema validation failure
    """


class GraphStoreError(GraphRAGError):
    """
    Raised when a graph persistence operation fails.

    Common causes:
    - Serialization / deserialization failure (pickle corruption)
    - Attempted write to a read-only store
    - Referential integrity violation (relationship references unknown element)
    """


class VectorStoreError(GraphRAGError):
    """
    Raised when a vector store operation fails.

    Common causes:
    - ChromaDB collection not initialised
    - Embedding model not loaded
    - Dimension mismatch between stored and query vectors
    """


class UnsupportedFileTypeError(ParseError):
    """
    Raised when no :class:`~core.interfaces.IParser` supports the given file.

    The exception message should include the unsupported extension so the
    caller can surface a helpful error to the end user.

    Example::

        raise UnsupportedFileTypeError(
            f"No parser available for file type '.{ext}'. "
            "Supported types: .pdf, .docx, .txt"
        )
    """

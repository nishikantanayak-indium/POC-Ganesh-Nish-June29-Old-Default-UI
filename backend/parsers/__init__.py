"""
Parsers package for the GraphRAG POC.

Exports concrete parser implementations and a :class:`ParserFactory` that
selects the correct parser for a given filename based on file extension.
"""

from .pdf_parser import PDFParser
from .docx_parser import DOCXParser
from core.exceptions import UnsupportedFileTypeError
from core.interfaces import IParser

__all__ = ["PDFParser", "DOCXParser", "ParserFactory"]


class ParserFactory:
    """
    Selects and returns the appropriate :class:`~core.interfaces.IParser`
    for a given filename.

    Parsers are evaluated in declaration order; the first one whose
    :meth:`~core.interfaces.IParser.supports` method returns ``True`` is
    returned.

    Usage::

        parser = ParserFactory.get_parser("proposal.pdf")
        doc = parser.parse(open("proposal.pdf", "rb"), "proposal.pdf")
    """

    _parsers: list[IParser] = [PDFParser(), DOCXParser()]

    @classmethod
    def get_parser(cls, filename: str) -> IParser:
        """
        Return the first registered parser that supports *filename*.

        Parameters
        ----------
        filename:
            Filename (with or without path) to match.

        Returns
        -------
        IParser
            A parser instance ready to call ``.parse()``.

        Raises
        ------
        core.exceptions.UnsupportedFileTypeError
            If no registered parser handles the file extension.
        """
        for parser in cls._parsers:
            if parser.supports(filename):
                return parser
        raise UnsupportedFileTypeError(f"No parser for: {filename}")

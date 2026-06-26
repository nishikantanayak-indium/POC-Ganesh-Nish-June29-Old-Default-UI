"""
Graph visualisation utilities using pyvis.

:class:`GraphVisualizer` generates self-contained HTML files / strings that
can be embedded directly in a Streamlit ``st.components.v1.html`` call or
written to disk.

Two render modes are provided:

* :meth:`generate_html`           — full graph (optionally hiding CONTAINS edges)
* :meth:`generate_subgraph_html`  — ego-network around a given node (BFS depth)
"""

from __future__ import annotations

import logging
from collections import deque

from pyvis.network import Network

from .neo4j_store import Neo4jGraphStore

logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Visual style constants
# ---------------------------------------------------------------------------

NODE_COLORS: dict[str, str] = {
    "Document": "#4A90D9",
    "Requirement": "#27AE60",
    "Clause": "#F39C12",
    "Risk": "#E74C3C",
    "Mitigation": "#9B59B6",
    "LD": "#1ABC9C",
}

EDGE_COLORS: dict[str, str] = {
    "CONTAINS": "#95A5A6",
    "COVERS": "#27AE60",
    "PARTIALLY_COVERS": "#F39C12",
    "INTRODUCES_RISK": "#E74C3C",
    "MITIGATED_BY": "#9B59B6",
    "LINKED_TO_LD": "#1ABC9C",
    "CONTRADICTS": "#C0392B",
}

# forceAtlas2Based physics gives a readable, non-overlapping layout.
PHYSICS_OPTIONS: str = (
    '{"physics":{"enabled":true,'
    '"forceAtlas2Based":{'
    '"gravitationalConstant":-50,'
    '"centralGravity":0.01,'
    '"springLength":150,'
    '"springConstant":0.08},'
    '"solver":"forceAtlas2Based",'
    '"stabilization":{"iterations":150}},'
    '"interaction":{"hover":true,"navigationButtons":true}}'
)

_DARK_BG = "#1a1a2e"
_FONT_COLOR = "white"


class GraphVisualizer:
    """
    Produces interactive pyvis HTML visualisations of the knowledge graph.

    Parameters
    ----------
    store:
        An open :class:`~graph.neo4j_store.Neo4jGraphStore` instance.
        The visualizer does **not** own the store; callers manage its
        lifecycle.
    """

    def __init__(self, store: Neo4jGraphStore) -> None:
        self.store = store

    # ------------------------------------------------------------------
    # Full graph
    # ------------------------------------------------------------------

    def generate_html(
        self,
        height: str = "600px",
        width: str = "100%",
        show_contains: bool = False,
    ) -> str:
        """
        Render the entire knowledge graph as an HTML string.

        Parameters
        ----------
        height:
            CSS height of the canvas (e.g. ``"600px"``).
        width:
            CSS width of the canvas (e.g. ``"100%"``).
        show_contains:
            When ``False`` (default) ``CONTAINS`` edges are hidden to
            reduce visual clutter; set to ``True`` to show the document
            structure.

        Returns
        -------
        str
            Self-contained HTML string with embedded JavaScript.
        """
        graph_data = self.store.get_graph_for_visualization()
        net = Network(
            height=height,
            width=width,
            directed=True,
            bgcolor=_DARK_BG,
            font_color=_FONT_COLOR,
        )
        net.set_options(PHYSICS_OPTIONS)

        for n in graph_data["nodes"]:
            color = NODE_COLORS.get(n.get("type", ""), "#888888")
            title = (
                f"<b>{n['id']}</b><br>"
                f"Type: {n.get('type', '')}<br>"
                f"{str(n.get('text', ''))[:100]}<br>"
                f"Source: {n.get('source', '')}"
            )
            net.add_node(
                n["id"],
                label=n["id"],
                title=title,
                color=color,
                size=25 if n.get("type") == "Document" else 15,
                font={"size": 12, "color": _FONT_COLOR},
            )

        for e in graph_data["edges"]:
            if not show_contains and e.get("rtype") == "CONTAINS":
                continue
            color = EDGE_COLORS.get(e.get("rtype", ""), "#888888")
            conf = e.get("conf") or 1.0
            ev_snippet = str(e.get("ev") or "")[:80]
            title = (
                f"{e.get('rtype', '')}<br>"
                f"Conf: {float(conf):.2f}<br>"
                f"{ev_snippet}"
            )
            net.add_edge(
                e["src"],
                e["tgt"],
                title=title,
                label=str(e.get("rtype", "")).replace("_", " "),
                color=color,
                arrows="to",
                font={"size": 9, "color": "#cccccc"},
            )

        return net.generate_html(notebook=False)

    # ------------------------------------------------------------------
    # Subgraph (ego network)
    # ------------------------------------------------------------------

    def generate_subgraph_html(
        self,
        center_node_id: str,
        depth: int = 2,
    ) -> str:
        """
        Render the ego-network centred on *center_node_id* up to *depth* hops.

        Uses BFS over the undirected adjacency of the full graph to collect
        the neighbourhood, then renders only those nodes and the edges
        connecting them.

        Parameters
        ----------
        center_node_id:
            The ``id`` of the node to centre on.
        depth:
            BFS radius — how many hops from the centre to include.

        Returns
        -------
        str
            Self-contained HTML string, or a minimal error HTML if the
            requested node does not exist in the store.
        """
        graph_data = self.store.get_graph_for_visualization()
        node_map: dict[str, dict] = {n["id"]: n for n in graph_data["nodes"]}

        if center_node_id not in node_map:
            return (
                "<p style='color:white;font-family:sans-serif;padding:1em;'>"
                f"Node <code>{center_node_id}</code> not found in graph.</p>"
            )

        # Build undirected adjacency for BFS
        adj: dict[str, list[str]] = {}
        for e in graph_data["edges"]:
            adj.setdefault(e["src"], []).append(e["tgt"])
            adj.setdefault(e["tgt"], []).append(e["src"])

        visited: set[str] = {center_node_id}
        queue: deque[tuple[str, int]] = deque([(center_node_id, 0)])
        while queue:
            node, d = queue.popleft()
            if d < depth:
                for neighbour in adj.get(node, []):
                    if neighbour not in visited:
                        visited.add(neighbour)
                        queue.append((neighbour, d + 1))

        sub_nodes = [node_map[n] for n in visited if n in node_map]
        sub_edges = [
            e
            for e in graph_data["edges"]
            if e["src"] in visited and e["tgt"] in visited
        ]

        net = Network(
            height="500px",
            width="100%",
            directed=True,
            bgcolor=_DARK_BG,
            font_color=_FONT_COLOR,
        )
        net.set_options(PHYSICS_OPTIONS)

        for n in sub_nodes:
            color = NODE_COLORS.get(n.get("type", ""), "#888888")
            title = (
                f"<b>{n['id']}</b><br>"
                f"{str(n.get('text', ''))[:100]}"
            )
            net.add_node(
                n["id"],
                label=n["id"],
                title=title,
                color=color,
                # Make the centre node visually prominent
                size=30 if n["id"] == center_node_id else 15,
                font={"size": 12, "color": _FONT_COLOR},
            )

        for e in sub_edges:
            color = EDGE_COLORS.get(e.get("rtype", ""), "#888888")
            net.add_edge(
                e["src"],
                e["tgt"],
                label=str(e.get("rtype", "")).replace("_", " "),
                color=color,
                arrows="to",
            )

        return net.generate_html(notebook=False)

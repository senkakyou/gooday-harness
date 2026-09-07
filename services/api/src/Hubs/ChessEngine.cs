namespace GoodayTools.Hubs;

public static class ChessEngine
{
    public static List<ChessPiece> InitBoard()
    {
        int id = 0;
        ChessPiece Mk(string t, int s, int c, int r) => new() { Id = id++, Type = t, Side = s, Col = c, Row = r };
        return [
            Mk("R",1,0,0), Mk("H",1,1,0), Mk("E",1,2,0), Mk("A",1,3,0),
            Mk("K",1,4,0), Mk("A",1,5,0), Mk("E",1,6,0), Mk("H",1,7,0), Mk("R",1,8,0),
            Mk("C",1,1,2), Mk("C",1,7,2),
            Mk("P",1,0,3), Mk("P",1,2,3), Mk("P",1,4,3), Mk("P",1,6,3), Mk("P",1,8,3),
            Mk("R",0,0,9), Mk("H",0,1,9), Mk("E",0,2,9), Mk("A",0,3,9),
            Mk("K",0,4,9), Mk("A",0,5,9), Mk("E",0,6,9), Mk("H",0,7,9), Mk("R",0,8,9),
            Mk("C",0,1,7), Mk("C",0,7,7),
            Mk("P",0,0,6), Mk("P",0,2,6), Mk("P",0,4,6), Mk("P",0,6,6), Mk("P",0,8,6),
        ];
    }

    public static ChessPiece? GetAt(List<ChessPiece> b, int c, int r) =>
        b.FirstOrDefault(p => p.Alive && p.Col == c && p.Row == r);

    private static bool InB(int c, int r) => c >= 0 && c < 9 && r >= 0 && r < 10;

    private static bool InPalace(int c, int r, int side) =>
        c >= 3 && c <= 5 && (side == 1 ? r >= 0 && r <= 2 : r >= 7 && r <= 9);

    private static bool Crossed(int side, int row) => side == 0 ? row <= 4 : row >= 5;

    public static List<(int, int)> RawMoves(List<ChessPiece> b, ChessPiece p)
    {
        var moves = new List<(int, int)>();
        int opp = 1 - p.Side;
        switch (p.Type)
        {
            case "K":
                foreach (var (dc, dr) in new[] { (0,1),(0,-1),(1,0),(-1,0) }) {
                    int nc = p.Col+dc, nr = p.Row+dr;
                    if (!InPalace(nc, nr, p.Side)) continue;
                    var t = GetAt(b, nc, nr); if (t == null || t.Side == opp) moves.Add((nc, nr));
                } break;
            case "A":
                foreach (var (dc, dr) in new[] { (1,1),(1,-1),(-1,1),(-1,-1) }) {
                    int nc = p.Col+dc, nr = p.Row+dr;
                    if (!InPalace(nc, nr, p.Side)) continue;
                    var t = GetAt(b, nc, nr); if (t == null || t.Side == opp) moves.Add((nc, nr));
                } break;
            case "E":
                foreach (var (dc, dr) in new[] { (2,2),(2,-2),(-2,2),(-2,-2) }) {
                    int nc = p.Col+dc, nr = p.Row+dr;
                    if (!InB(nc, nr)) continue;
                    if (p.Side == 0 && nr < 5) continue;
                    if (p.Side == 1 && nr > 4) continue;
                    if (GetAt(b, p.Col+dc/2, p.Row+dr/2) != null) continue;
                    var t = GetAt(b, nc, nr); if (t == null || t.Side == opp) moves.Add((nc, nr));
                } break;
            case "H":
                foreach (var (bc, br, dc, dr) in new[] {
                    (1,0,2,1),(1,0,2,-1),(-1,0,-2,1),(-1,0,-2,-1),
                    (0,1,1,2),(0,1,-1,2),(0,-1,1,-2),(0,-1,-1,-2) }) {
                    if (GetAt(b, p.Col+bc, p.Row+br) != null) continue;
                    int nc = p.Col+dc, nr = p.Row+dr;
                    if (!InB(nc, nr)) continue;
                    var t = GetAt(b, nc, nr); if (t == null || t.Side == opp) moves.Add((nc, nr));
                } break;
            case "R":
                foreach (var (dc, dr) in new[] { (0,1),(0,-1),(1,0),(-1,0) }) {
                    int nc = p.Col+dc, nr = p.Row+dr;
                    while (InB(nc, nr)) {
                        var t = GetAt(b, nc, nr);
                        if (t != null) { if (t.Side == opp) moves.Add((nc, nr)); break; }
                        moves.Add((nc, nr)); nc += dc; nr += dr;
                    }
                } break;
            case "C":
                foreach (var (dc, dr) in new[] { (0,1),(0,-1),(1,0),(-1,0) }) {
                    int nc = p.Col+dc, nr = p.Row+dr; bool platform = false;
                    while (InB(nc, nr)) {
                        var t = GetAt(b, nc, nr);
                        if (!platform) { if (t != null) platform = true; else moves.Add((nc, nr)); }
                        else { if (t != null) { if (t.Side == opp) moves.Add((nc, nr)); break; } }
                        nc += dc; nr += dr;
                    }
                } break;
            case "P": {
                int fwd = p.Side == 0 ? -1 : 1;
                bool cr = Crossed(p.Side, p.Row);
                var cands = new List<(int, int)> { (p.Col, p.Row+fwd) };
                if (cr) { cands.Add((p.Col-1, p.Row)); cands.Add((p.Col+1, p.Row)); }
                foreach (var (nc, nr) in cands) {
                    if (!InB(nc, nr)) continue;
                    var t = GetAt(b, nc, nr); if (t == null || t.Side == opp) moves.Add((nc, nr));
                }
                break;
            }
        }
        return moves;
    }

    public static bool InCheck(List<ChessPiece> b, int side)
    {
        var king = b.FirstOrDefault(p => p.Alive && p.Type == "K" && p.Side == side);
        if (king == null) return false;
        var oppKing = b.FirstOrDefault(p => p.Alive && p.Type == "K" && p.Side != side);
        if (oppKing != null && oppKing.Col == king.Col) {
            int r1 = Math.Min(king.Row, oppKing.Row), r2 = Math.Max(king.Row, oppKing.Row);
            if (!b.Any(p => p.Alive && p.Col == king.Col && p.Row > r1 && p.Row < r2)) return true;
        }
        return b.Where(p => p.Alive && p.Side != side)
                .Any(p => RawMoves(b, p).Any(m => m.Item1 == king.Col && m.Item2 == king.Row));
    }

    public static List<ChessPiece> Apply(List<ChessPiece> b, ChessPiece piece, int tc, int tr) =>
        b.Select(p => {
            if (p.Id == piece.Id)
                return new ChessPiece { Id=p.Id, Type=p.Type, Side=p.Side, Col=tc, Row=tr, Alive=true };
            if (p.Alive && p.Col == tc && p.Row == tr && p.Side != piece.Side)
                return new ChessPiece { Id=p.Id, Type=p.Type, Side=p.Side, Col=p.Col, Row=p.Row, Alive=false };
            return new ChessPiece { Id=p.Id, Type=p.Type, Side=p.Side, Col=p.Col, Row=p.Row, Alive=p.Alive };
        }).ToList();

    public static bool IsLegal(List<ChessPiece> b, ChessPiece piece, int tc, int tr) =>
        RawMoves(b, piece).Any(m => m.Item1 == tc && m.Item2 == tr) &&
        !InCheck(Apply(b, piece, tc, tr), piece.Side);

    public static bool HasLegalMoves(List<ChessPiece> b, int side) =>
        b.Where(p => p.Alive && p.Side == side)
         .Any(p => RawMoves(b, p).Any(m => !InCheck(Apply(b, p, m.Item1, m.Item2), side)));
}

namespace GoodayTools.Hubs;

public class GameSeat
{
    public string ConnectionId { get; set; } = "";
    public int? UserId { get; set; }
    public string Username { get; set; } = "";
    public int Level { get; set; } = 1;
}

public class GameTable
{
    public int Id { get; set; }
    public string GameType { get; set; } = "";
    public GameSeat?[] Seats { get; set; } = new GameSeat?[2];
    public string State { get; set; } = "open"; // open | playing | ended
    public int CurrentTurn { get; set; } = 0;
    public Dictionary<string, int> GomokuBoard { get; set; } = new();
    public List<ChessPiece> ChessBoard { get; set; } = new();
}

public class ChessPiece
{
    public int Id { get; set; }
    public string Type { get; set; } = ""; // K A E R H C P
    public int Side { get; set; }
    public int Col { get; set; }
    public int Row { get; set; }
    public bool Alive { get; set; } = true;
}

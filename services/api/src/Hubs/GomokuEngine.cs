namespace GoodayTools.Hubs;

public static class GomokuEngine
{
    private const int N = 15;

    public static bool CheckWin(Dictionary<string, int> board, int col, int row, int side)
    {
        int[][] dirs = [[1, 0], [0, 1], [1, 1], [1, -1]];
        foreach (var d in dirs)
        {
            int cnt = 1;
            for (int i = 1; i <= 4; i++) {
                if (!board.TryGetValue($"{col+d[0]*i},{row+d[1]*i}", out var s) || s != side) break;
                cnt++;
            }
            for (int i = 1; i <= 4; i++) {
                if (!board.TryGetValue($"{col-d[0]*i},{row-d[1]*i}", out var s) || s != side) break;
                cnt++;
            }
            if (cnt >= 5) return true;
        }
        return false;
    }
}

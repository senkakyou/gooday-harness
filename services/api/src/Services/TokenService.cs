// =====================================================
// Services/TokenService.cs —— JWT Token 生成服务
// 职责：把用户信息打包成 JWT token 字符串
//
// 理解 JWT（JSON Web Token）：
//   token = Header.Payload.Signature
//   Payload 里存了用户 id、用户名、角色等信息（明文，但有签名防篡改）
//   后端收到请求时验证签名，从 Payload 里读出用户身份，不需要查数据库
// =====================================================

using System.IdentityModel.Tokens.Jwt;
using System.Security.Claims;
using System.Text;
using Microsoft.IdentityModel.Tokens;
using GoodayTools.Models;
namespace GoodayTools.Services;

// IConfiguration 通过依赖注入自动传入（框架从 appsettings.json 读取配置）
public class TokenService(IConfiguration config) {

    public string GenerateToken(User user) {
        // 用配置文件里的密钥创建签名凭证
        var key = new SymmetricSecurityKey(Encoding.UTF8.GetBytes(config["Jwt:Secret"]!));
        var creds = new SigningCredentials(key, SecurityAlgorithms.HmacSha256);

        var claims = new List<Claim> {
            new Claim(ClaimTypes.NameIdentifier, user.Id.ToString()),
            new Claim(ClaimTypes.Name, user.Username),
            new Claim(ClaimTypes.Role, user.Role),
            new Claim("tver", user.TokenVersion.ToString())  // token 版本，用于吊销校验
        };
        if (!string.IsNullOrEmpty(user.Email))
            claims.Add(new Claim(ClaimTypes.Email, user.Email));

        // 生成 token：设置有效期为 7 天
        var token = new JwtSecurityToken(
            issuer: config["Jwt:Issuer"],
            audience: config["Jwt:Audience"],
            claims: claims,
            expires: DateTime.UtcNow.AddDays(7),
            signingCredentials: creds);

        // 序列化为字符串（就是那个 xxxxx.yyyyy.zzzzz 格式的长字符串）
        return new JwtSecurityTokenHandler().WriteToken(token);
    }
}

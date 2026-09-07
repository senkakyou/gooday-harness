FROM mcr.microsoft.com/dotnet/sdk:8.0 AS build
WORKDIR /src
COPY GoodayTools.csproj .
RUN dotnet restore
COPY . .
RUN dotnet publish -c Release -o /app/publish

FROM mcr.microsoft.com/dotnet/aspnet:8.0 AS runtime
WORKDIR /app
RUN mkdir -p /app/data /app/wwwroot/uploads
COPY --from=build /app/publish .
VOLUME ["/app/data", "/app/wwwroot/uploads"]
EXPOSE 8080
ENV ASPNETCORE_URLS=http://+:8080
ENV ASPNETCORE_ENVIRONMENT=Production
ENTRYPOINT ["dotnet", "GoodayTools.dll"]

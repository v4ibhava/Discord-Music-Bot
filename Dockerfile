FROM eclipse-temurin:21-jre
WORKDIR /app
COPY Lavalink.jar .
COPY application.yml .
EXPOSE 10000
CMD ["java", "-jar", "Lavalink.jar"]
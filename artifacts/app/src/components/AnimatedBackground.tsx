const bgImage = "/bg.jpg";

export default function AnimatedBackground() {
  return (
    <div style={{ position: "fixed", inset: 0, zIndex: 0 }}>
      <div
        style={{
          position: "absolute",
          inset: 0,
          backgroundImage: `url(${bgImage})`,
          backgroundSize: "cover",
          backgroundPosition: "center top",
          backgroundRepeat: "no-repeat",
        }}
      />
      <div
        style={{
          position: "absolute",
          inset: 0,
          background:
            "linear-gradient(to right, rgba(3,4,16,0.4) 0%, rgba(3,4,16,0.0) 25%, rgba(3,4,16,0.0) 75%, rgba(3,4,16,0.4) 100%)",
        }}
      />
      <div
        style={{
          position: "absolute",
          inset: 0,
          background:
            "linear-gradient(180deg, rgba(3,4,16,0.1) 0%, rgba(3,4,16,0.3) 60%, rgba(3,4,16,0.7) 100%)",
        }}
      />
    </div>
  );
}

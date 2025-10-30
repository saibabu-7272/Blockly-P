import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { GoogleMap, MarkerF, Polyline, useLoadScript } from "@react-google-maps/api";

const containerStyle = { width: "100%", height: "100%" };

function toLatLng(p) {
  return { lat: p.latitude, lng: p.longitude };
}

function lerp(a, b, t) {
  return a + (b - a) * t;
}

function interpolate(p1, p2, t) {
  return { lat: lerp(p1.lat, p2.lat, t), lng: lerp(p1.lng, p2.lng, t) };
}

function haversineKm(a, b) {
  const R = 6371;
  const dLat = ((b.lat - a.lat) * Math.PI) / 180;
  const dLng = ((b.lng - a.lng) * Math.PI) / 180;
  const la1 = (a.lat * Math.PI) / 180;
  const la2 = (b.lat * Math.PI) / 180;
  const sinDL = Math.sin(dLat / 2);
  const sinDN = Math.sin(dLng / 2);
  const c = sinDL * sinDL + Math.cos(la1) * Math.cos(la2) * sinDN * sinDN;
  const d = 2 * Math.atan2(Math.sqrt(c), Math.sqrt(1 - c));
  return R * d;
}

export default function MapPlayer() {
  const { isLoaded } = useLoadScript({ googleMapsApiKey: process.env.REACT_APP_GOOGLE_MAPS_API_KEY || "" });
  const [route, setRoute] = useState([]);
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState(1);
  const [segIndex, setSegIndex] = useState(0);
  const [segProgress, setSegProgress] = useState(0);
  const [drawnPath, setDrawnPath] = useState([]);
  const rafRef = useRef(0);
  const lastTsRef = useRef(0);

  useEffect(() => {
    fetch("/dummy-route.json").then(r => r.json()).then(data => {
      const cleaned = data.map(d => ({ latitude: d.latitude, longitude: d.longitude, timestamp: d.timestamp || null }));
      setRoute(cleaned);
      setDrawnPath(cleaned.length ? [toLatLng(cleaned[0])] : []);
    });
  }, []);

  const defaultCenter = useMemo(() => (route.length ? toLatLng(route[0]) : { lat: 0, lng: 0 }), [route]);

  const segmentDurationMs = useCallback((i) => {
    if (!route[i] || !route[i + 1]) return 2000;
    const t1 = route[i].timestamp ? Date.parse(route[i].timestamp) : null;
    const t2 = route[i + 1].timestamp ? Date.parse(route[i + 1].timestamp) : null;
    if (t1 && t2 && t2 > t1) return Math.min(8000, Math.max(500, t2 - t1));
    return 2000;
  }, [route]);

  useEffect(() => {
    if (!playing) return;
    function step(ts) {
      if (!lastTsRef.current) lastTsRef.current = ts;
      const dt = ts - lastTsRef.current;
      lastTsRef.current = ts;
      const dur = segmentDurationMs(segIndex) / speed;
      if (route.length < 2 || !route[segIndex + 1]) return;
      let p = segProgress + dt / dur;
      if (p >= 1) {
        const nextIndex = segIndex + 1;
        setDrawnPath(prev => prev.concat([toLatLng(route[nextIndex])]))
        setSegIndex(nextIndex);
        p = p - 1;
        if (!route[nextIndex + 1]) {
          setSegProgress(0);
          setPlaying(false);
          lastTsRef.current = 0;
          return;
        }
      }
      setSegProgress(p);
      rafRef.current = requestAnimationFrame(step);
    }
    rafRef.current = requestAnimationFrame(step);
    return () => cancelAnimationFrame(rafRef.current);
  }, [playing, route, segIndex, segProgress, speed, segmentDurationMs]);

  const currentLatLng = useMemo(() => {
    if (!route.length) return defaultCenter;
    const a = toLatLng(route[Math.min(segIndex, route.length - 1)]);
    const b = route[segIndex + 1] ? toLatLng(route[segIndex + 1]) : a;
    return interpolate(a, b, segProgress);
  }, [route, segIndex, segProgress, defaultCenter]);

  const onPlayPause = () => {
    if (!route.length) return;
    setPlaying(v => !v);
    if (!playing) lastTsRef.current = 0;
  };

  const onSeek = (e) => {
    const idx = parseInt(e.target.value, 10);
    setSegIndex(idx);
    setSegProgress(0);
    setDrawnPath(route.slice(0, idx + 1).map(toLatLng));
    lastTsRef.current = 0;
  };

  const totalSegments = Math.max(0, route.length - 1);

  const speedKmh = useMemo(() => {
    if (!route[segIndex] || !route[segIndex + 1]) return 0;
    const a = toLatLng(route[segIndex]);
    const b = toLatLng(route[segIndex + 1]);
    const km = haversineKm(a, b);
    const hrs = segmentDurationMs(segIndex) / 3600000;
    return Math.round((km / hrs) * speed);
  }, [route, segIndex, speed, segmentDurationMs]);

  if (!isLoaded) return <div className="loading">Loading map...</div>;

  return (
    <div className="map-page">
      <div className="map-wrapper">
        <GoogleMap mapContainerStyle={containerStyle} center={currentLatLng} zoom={15} options={{ clickableIcons: false, streetViewControl: false, mapTypeControl: true }}>
          {route.length > 1 && (
            <Polyline path={route.map(toLatLng)} options={{ strokeColor: "#7fbf7f", strokeOpacity: 0.6, strokeWeight: 4 }} />
          )}
          {drawnPath.length > 1 && (
            <Polyline path={drawnPath} options={{ strokeColor: "#008000", strokeOpacity: 1, strokeWeight: 5 }} />
          )}
          <MarkerF position={currentLatLng} />
        </GoogleMap>
        <div className="controls">
          <div className="row">
            <input type="range" min={0} max={totalSegments} value={Math.min(segIndex, totalSegments)} onChange={onSeek} className="progress" />
          </div>
          <div className="row gap">
            <button className="btn" onClick={onPlayPause}>{playing ? "Pause" : "Play"}</button>
            <div className="speed">
              <span className="label">Speed</span>
              <input type="range" min={0.5} max={4} step={0.5} value={speed} onChange={(e) => setSpeed(parseFloat(e.target.value))} />
              <span className="value">{speed.toFixed(1)}x</span>
            </div>
          </div>
          <div className="row meta">
            <div className="meta-item">Lat: {currentLatLng.lat.toFixed(6)}</div>
            <div className="meta-item">Lng: {currentLatLng.lng.toFixed(6)}</div>
            <div className="meta-item">Speed: {speedKmh} km/h</div>
          </div>
        </div>
      </div>
    </div>
  );
}

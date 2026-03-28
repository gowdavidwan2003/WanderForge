import { NextResponse } from 'next/server';

export async function GET(request) {
  const { searchParams } = new URL(request.url);
  const lat = searchParams.get('lat');
  const lng = searchParams.get('lng');
  const date = searchParams.get('date'); // optional

  if (!lat || !lng) {
    return NextResponse.json({ error: 'lat and lng required' }, { status: 400 });
  }

  try {
    // Use Open-Meteo (free, no key needed)
    let url;
    if (date) {
      // Forecast for specific date
      url = `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lng}&daily=temperature_2m_max,temperature_2m_min,precipitation_sum,weathercode,windspeed_10m_max&start_date=${date}&end_date=${date}&timezone=auto`;
    } else {
      // 7-day forecast
      url = `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lng}&daily=temperature_2m_max,temperature_2m_min,precipitation_sum,weathercode,windspeed_10m_max&timezone=auto`;
    }

    const response = await fetch(url);
    if (!response.ok) throw new Error('Weather API error');

    const data = await response.json();

    // Map weather codes to human-readable descriptions
    const weatherDescriptions = {
      0: { desc: 'Clear sky', icon: '☀️' },
      1: { desc: 'Mainly clear', icon: '🌤️' },
      2: { desc: 'Partly cloudy', icon: '⛅' },
      3: { desc: 'Overcast', icon: '☁️' },
      45: { desc: 'Foggy', icon: '🌫️' },
      48: { desc: 'Depositing rime fog', icon: '🌫️' },
      51: { desc: 'Light drizzle', icon: '🌦️' },
      53: { desc: 'Moderate drizzle', icon: '🌦️' },
      55: { desc: 'Dense drizzle', icon: '🌧️' },
      61: { desc: 'Slight rain', icon: '🌧️' },
      63: { desc: 'Moderate rain', icon: '🌧️' },
      65: { desc: 'Heavy rain', icon: '🌧️' },
      71: { desc: 'Slight snow', icon: '🌨️' },
      73: { desc: 'Moderate snow', icon: '🌨️' },
      75: { desc: 'Heavy snow', icon: '❄️' },
      77: { desc: 'Snow grains', icon: '🌨️' },
      80: { desc: 'Slight rain showers', icon: '🌦️' },
      81: { desc: 'Moderate rain showers', icon: '🌧️' },
      82: { desc: 'Violent rain showers', icon: '⛈️' },
      85: { desc: 'Slight snow showers', icon: '🌨️' },
      86: { desc: 'Heavy snow showers', icon: '❄️' },
      95: { desc: 'Thunderstorm', icon: '⛈️' },
      96: { desc: 'Thunderstorm with hail', icon: '⛈️' },
      99: { desc: 'Thunderstorm with heavy hail', icon: '⛈️' },
    };

    const forecast = data.daily.time.map((date, i) => {
      const code = data.daily.weathercode[i];
      const weather = weatherDescriptions[code] || { desc: 'Unknown', icon: '🌡️' };
      return {
        date,
        tempMax: data.daily.temperature_2m_max[i],
        tempMin: data.daily.temperature_2m_min[i],
        precipitation: data.daily.precipitation_sum[i],
        windSpeed: data.daily.windspeed_10m_max[i],
        weatherCode: code,
        description: weather.desc,
        icon: weather.icon,
      };
    });

    return NextResponse.json({
      location: { lat: parseFloat(lat), lng: parseFloat(lng) },
      timezone: data.timezone,
      forecast,
    });
  } catch (err) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

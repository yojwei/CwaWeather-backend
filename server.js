require("dotenv").config();
const express = require("express");
const cors = require("cors");
const axios = require("axios");

const app = express();
const PORT = process.env.PORT || 3000;

// CWA API 設定
const CWA_API_BASE_URL = "https://opendata.cwa.gov.tw/api";
const CWA_API_KEY = process.env.CWA_API_KEY;

// 快取設定
const CACHE_TTL = 10 * 60 * 1000; // 快取時間：10 分鐘（毫秒）
const weatherCache = new Map(); // 儲存快取資料

/**
 * 取得快取資料
 * @param {string} key - 快取鍵值
 * @returns {object|null} - 快取資料或 null
 */
const getCache = (key) => {
  const cached = weatherCache.get(key);
  if (!cached) return null;

  // 檢查是否過期
  if (Date.now() - cached.timestamp > CACHE_TTL) {
    weatherCache.delete(key);
    return null;
  }

  return cached.data;
};

/**
 * 設定快取資料
 * @param {string} key - 快取鍵值
 * @param {object} data - 要快取的資料
 */
const setCache = (key, data) => {
  weatherCache.set(key, {
    data,
    timestamp: Date.now(),
  });
};

// 全台 22 縣市對照表（英文代碼 -> 中文名稱）
const CITY_MAP = {
  taipei: "臺北市",
  newtaipei: "新北市",
  keelung: "基隆市",
  taoyuan: "桃園市",
  hsinchu: "新竹市",
  hsinchucounty: "新竹縣",
  miaoli: "苗栗縣",
  taichung: "臺中市",
  changhua: "彰化縣",
  nantou: "南投縣",
  yunlin: "雲林縣",
  chiayi: "嘉義市",
  chiayicounty: "嘉義縣",
  tainan: "臺南市",
  kaohsiung: "高雄市",
  pingtung: "屏東縣",
  yilan: "宜蘭縣",
  hualien: "花蓮縣",
  taitung: "臺東縣",
  penghu: "澎湖縣",
  kinmen: "金門縣",
  lienchiang: "連江縣",
};

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

/**
 * 取得指定縣市天氣預報
 * CWA 氣象資料開放平臺 API
 * 使用「一般天氣預報-今明 36 小時天氣預報」資料集 F-C0032-001
 * @param {string} cityCode - 縣市英文代碼
 */
const getCityWeather = async (req, res) => {
  try {
    const { city } = req.params;
    const cityCode = city.toLowerCase();
    const cityName = CITY_MAP[cityCode];

    // 檢查縣市代碼是否有效
    if (!cityName) {
      return res.status(400).json({
        error: "無效的縣市代碼",
        message: `請使用有效的縣市代碼`,
        availableCities: Object.keys(CITY_MAP),
      });
    }

    // 檢查快取
    const cacheKey = `weather_${cityCode}`;
    const cachedData = getCache(cacheKey);
    if (cachedData) {
      return res.json({
        success: true,
        data: cachedData,
        cached: true,
      });
    }

    // 檢查是否有設定 API Key
    if (!CWA_API_KEY) {
      return res.status(500).json({
        error: "伺服器設定錯誤",
        message: "請在 .env 檔案中設定 CWA_API_KEY",
      });
    }

    // 呼叫 CWA API - 一般天氣預報（36小時）
    // API 文件: https://opendata.cwa.gov.tw/dist/opendata-swagger.html
    const response = await axios.get(
      `${CWA_API_BASE_URL}/v1/rest/datastore/F-C0032-001`,
      {
        params: {
          Authorization: CWA_API_KEY,
          locationName: cityName,
        },
      }
    );

    // 取得指定縣市的天氣資料
    const locationData = response.data.records.location[0];

    if (!locationData) {
      return res.status(404).json({
        error: "查無資料",
        message: `無法取得${cityName}天氣資料`,
      });
    }

    // 整理天氣資料
    const weatherData = {
      city: locationData.locationName,
      updateTime: response.data.records.datasetDescription,
      forecasts: [],
    };

    // 解析天氣要素
    const weatherElements = locationData.weatherElement;
    const timeCount = weatherElements[0].time.length;

    for (let i = 0; i < timeCount; i++) {
      const forecast = {
        startTime: weatherElements[0].time[i].startTime,
        endTime: weatherElements[0].time[i].endTime,
        weather: "",
        rain: "",
        minTemp: "",
        maxTemp: "",
        comfort: "",
      };

      weatherElements.forEach((element) => {
        const value = element.time[i].parameter;
        switch (element.elementName) {
          case "Wx": // 天氣現象
            forecast.weather = value.parameterName;
            break;
          case "PoP": // 降雨機率
            forecast.rain = value.parameterName + "%";
            break;
          case "MinT": // 最低溫度
            forecast.minTemp = value.parameterName + "°C";
            break;
          case "MaxT": // 最高溫度
            forecast.maxTemp = value.parameterName + "°C";
            break;
          case "CI": // 舒適度
            forecast.comfort = value.parameterName;
            break;
        }
      });

      weatherData.forecasts.push(forecast);
    }

    // 儲存到快取
    setCache(cacheKey, weatherData);

    res.json({
      success: true,
      data: weatherData,
      cached: false,
    });
  } catch (error) {
    console.error("取得天氣資料失敗:", error.message);

    if (error.response) {
      // API 回應錯誤
      return res.status(error.response.status).json({
        error: "CWA API 錯誤",
        message: error.response.data.message || "無法取得天氣資料",
        details: error.response.data,
      });
    }

    // 其他錯誤
    res.status(500).json({
      error: "伺服器錯誤",
      message: "無法取得天氣資料，請稍後再試",
    });
  }
};

// Routes
app.get("/", (req, res) => {
  res.json({
    message: "歡迎使用 CWA 天氣預報 API",
    endpoints: {
      weather: "/api/weather/:city",
      cities: "/api/cities",
      health: "/api/health",
    },
    example: "/api/weather/taipei",
  });
});

app.get("/api/health", (req, res) => {
  res.json({ status: "OK", timestamp: new Date().toISOString() });
});

// 取得所有可用縣市列表
app.get("/api/cities", (req, res) => {
  res.json({
    success: true,
    data: Object.entries(CITY_MAP).map(([code, name]) => ({
      code,
      name,
    })),
  });
});

// 取得指定縣市天氣預報
app.get("/api/weather/:city", getCityWeather);

// Error handling middleware
app.use((err, req, res, next) => {
  console.error(err.stack);
  res.status(500).json({
    error: "伺服器錯誤",
    message: err.message,
  });
});

// 404 handler
app.use((req, res) => {
  res.status(404).json({
    error: "找不到此路徑",
  });
});

app.listen(PORT, () => {
  console.log(`🚀 伺服器運行已運作`);
  console.log(`📍 環境: ${process.env.NODE_ENV || "development"}`);
});

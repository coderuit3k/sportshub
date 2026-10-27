/**
 * REAL venue catalog — 119 Ho Chi Minh City venues harvested from
 * Google Maps on 2026-10-27 (name, address, coordinates and the Google
 * rating aggregate are the venue's real public data; see
 * ~/workspace/real-venues/*.json for the raw harvest this module was
 * generated from).
 *
 * The raw harvest held 120 listings (20 per sport). Listings that are
 * the same business under two sports — identical normalized name AND
 * identical coordinates at 4 decimals — are merged into ONE venue
 * with several sports (known case: "PooC Cầu Lông & PickleBall",
 * harvested under both cau-long and pickleball), leaving 119 unique
 * venues in REAL_VENUES.
 *
 * Everything in this module is pure data + pure helpers; the database
 * side lives in prisma/real-catalog.ts.
 */
import { slugify, SPORT_DEFS, type SportSlug } from "./venue-catalog";

/** One harvested listing, exactly as collected (before merging). */
export interface RawRealVenueEntry {
  sportSlug: SportSlug;
  name: string;
  address: string;
  /** District as parsed at harvest time; "" when unparseable. */
  district: string;
  latitude: number;
  longitude: number;
  rating: number;
  ratingCount: number;
  /** Raw Google Maps hours string ("06:00–23:00 hằng ngày",
   * "Đóng cửa vào 23:00", "Mở cả ngày", …); null when Maps showed none. */
  openHours: string | null;
}

/** A unique real venue, ready for the importer. */
export interface RealVenue {
  slug: string;
  name: string;
  address: string;
  district: string;
  latitude: number;
  longitude: number;
  googleRating: number;
  googleRatingCount: number;
  openHours: string | null;
  sportSlugs: SportSlug[];
}


/** The raw harvest: 120 listings, 20 per sport, in SPORT_DEFS order. */
export const RAW_REAL_VENUE_ENTRIES: RawRealVenueEntry[] = [
  {
    sportSlug: "cau-long",
    name: "Sân Cầu Lông Đông Hồ",
    address: "37 Đông Hồ, Tân Hòa, Hồ Chí Minh, Việt Nam",
    district: "",
    latitude: 10.7835445,
    longitude: 106.6527103,
    rating: 4.9,
    ratingCount: 286,
    openHours: "06:00–23:00 hằng ngày"
  },
  {
    sportSlug: "cau-long",
    name: "Sân cầu lông Sài Gòn",
    address: "237/2/3 Hòa Bình, Phú Thạnh, Hồ Chí Minh, Việt Nam",
    district: "",
    latitude: 10.7719936,
    longitude: 106.6246755,
    rating: 5.0,
    ratingCount: 80,
    openHours: "06:00–23:00 hằng ngày"
  },
  {
    sportSlug: "cau-long",
    name: "PooC Cầu Lông & PickleBall",
    address: "202B Đ. Hoàng Văn Thụ, Đức Nhuận, Hồ Chí Minh 700000, Việt Nam",
    district: "",
    latitude: 10.8002048,
    longitude: 106.6695914,
    rating: 4.8,
    ratingCount: 1449,
    openHours: "05:00–00:00 hằng ngày"
  },
  {
    sportSlug: "cau-long",
    name: "Sân Cầu Lông - Pickleball NHÓM BẠN - Quận Tân Phú",
    address: "368 Thoại Ngọc Hầu, Phú Thạnh, Hồ Chí Minh 72013, Việt Nam",
    district: "Tân Phú",
    latitude: 10.774506,
    longitude: 106.6226084,
    rating: 4.9,
    ratingCount: 356,
    openHours: "Mở cửa cả ngày"
  },
  {
    sportSlug: "cau-long",
    name: "Sân Cầu Lông GENZ",
    address: "Hẻm 111/9 Đ. Phạm Văn Chiêu, An Hội Tây, Hồ Chí Minh, Việt Nam",
    district: "",
    latitude: 10.846859,
    longitude: 106.644017,
    rating: 4.7,
    ratingCount: 340,
    openHours: "Đóng cửa vào 23:00"
  },
  {
    sportSlug: "cau-long",
    name: "AURORA SPORT - Cầu Lông, Pickleball, Bóng Bàn",
    address: "158 Đ. số 17, Linh Xuân, Hồ Chí Minh 71308, Việt Nam",
    district: "",
    latitude: 10.8662804,
    longitude: 106.7875994,
    rating: 4.9,
    ratingCount: 220,
    openHours: "Đóng cửa vào 23:00"
  },
  {
    sportSlug: "cau-long",
    name: "Sân Cầu Lông H3 - H3 Badminton Court",
    address: "QJ7M+37C, 2 Đường Lê Quát, Tân Phú, Hồ Chí Minh 700000, Việt Nam",
    district: "Tân Phú",
    latitude: 10.7640964,
    longitude: 106.6329078,
    rating: 4.9,
    ratingCount: 223,
    openHours: "Đóng cửa vào 0:00"
  },
  {
    sportSlug: "cau-long",
    name: "Sân Cầu Lông Thiên Khang",
    address: "369 Thoại Ngọc Hầu, Phú Thạnh, Hồ Chí Minh, Việt Nam",
    district: "",
    latitude: 10.7751766,
    longitude: 106.6244447,
    rating: 4.8,
    ratingCount: 222,
    openHours: "Đóng cửa vào 0:00"
  },
  {
    sportSlug: "cau-long",
    name: "Be Badminton - Sân Cầu Lông",
    address: "262/1 Quang Trung, Gò Vấp, Hồ Chí Minh, Việt Nam",
    district: "Gò Vấp",
    latitude: 10.8303397,
    longitude: 106.6705384,
    rating: 4.8,
    ratingCount: 568,
    openHours: "Đóng cửa vào 0:00"
  },
  {
    sportSlug: "cau-long",
    name: "The B Hòa Bình - Sân Cầu Lông Tân Phú",
    address: "314 - 316 Hòa Bình, Phú Thạnh, Hồ Chí Minh 72000, Việt Nam",
    district: "",
    latitude: 10.7734021,
    longitude: 106.6226397,
    rating: 4.7,
    ratingCount: 455,
    openHours: "Đóng cửa vào 2:00"
  },
  {
    sportSlug: "cau-long",
    name: "Ecosport - Sân cầu lông chi nhánh Cách Mạng",
    address: "15 Cách Mạng, Phú Thọ Hòa, Hồ Chí Minh 72000, Việt Nam",
    district: "",
    latitude: 10.7890963,
    longitude: 106.6364317,
    rating: 4.8,
    ratingCount: 506,
    openHours: "Đóng cửa vào 23:00"
  },
  {
    sportSlug: "cau-long",
    name: "Sân cầu lông Kỳ Hòa",
    address: "238 3 Tháng 2, Hòa Hưng, Hồ Chí Minh 70000, Việt Nam",
    district: "",
    latitude: 10.7734968,
    longitude: 106.6733204,
    rating: 4.2,
    ratingCount: 280,
    openHours: "Đóng cửa vào 22:00"
  },
  {
    sportSlug: "cau-long",
    name: "BÌNH MINH - Sân Cầu Lông & Huấn Luyện",
    address: "310/3 Mã Lò, Bình Trị Đông, Hồ Chí Minh, Việt Nam",
    district: "",
    latitude: 10.7740293,
    longitude: 106.6020333,
    rating: 4.9,
    ratingCount: 30,
    openHours: "Mở cả ngày"
  },
  {
    sportSlug: "cau-long",
    name: "SÂN CẦU LÔNG LEVEL UP - LEVEL UP BADMINTON",
    address: "30 Đ. Số 24, An Khánh, Hồ Chí Minh 70000, Việt Nam",
    district: "",
    latitude: 10.7943806,
    longitude: 106.7298461,
    rating: 4.7,
    ratingCount: 16,
    openHours: "Đóng cửa vào 23:00"
  },
  {
    sportSlug: "cau-long",
    name: "Cầu lông Đông Phương",
    address: "873 Đ. Số 47, Bình Trưng, Hồ Chí Minh, Việt Nam",
    district: "",
    latitude: 10.7894886,
    longitude: 106.7763212,
    rating: 4.4,
    ratingCount: 270,
    openHours: "Đóng cửa vào 22:30"
  },
  {
    sportSlug: "cau-long",
    name: "Sơn Tạ Sport",
    address: "313/7 Phan Huy Ích, An Hội Tây, Hồ Chí Minh, Việt Nam",
    district: "",
    latitude: 10.8396997,
    longitude: 106.633698,
    rating: 4.6,
    ratingCount: 452,
    openHours: "Mở cả ngày"
  },
  {
    sportSlug: "cau-long",
    name: "Ecosport - Sân cầu lông chi nhánh Gò Dầu",
    address: "185/22 Đ. Gò Dầu, Phú Thọ Hòa, Hồ Chí Minh 72054, Việt Nam",
    district: "",
    latitude: 10.795002,
    longitude: 106.6183612,
    rating: 4.9,
    ratingCount: 218,
    openHours: "Đóng cửa vào 23:00"
  },
  {
    sportSlug: "cau-long",
    name: "Sân cầu lông Đại Phát",
    address: "313/17 Phan Huy Ích, An Hội Tây, Hồ Chí Minh 70000, Việt Nam",
    district: "",
    latitude: 10.8387338,
    longitude: 106.6341503,
    rating: 4.6,
    ratingCount: 283,
    openHours: "Đóng cửa vào 0:00"
  },
  {
    sportSlug: "cau-long",
    name: "Sân cầu lông/Badminton Club Tấn Phúc - Tân Phú",
    address: "36/48 Đ. Huỳnh Thiện Lộc, Tân Phú, Hồ Chí Minh, Việt Nam",
    district: "Tân Phú",
    latitude: 10.7787125,
    longitude: 106.6362366,
    rating: 4.4,
    ratingCount: 208,
    openHours: "Đóng cửa vào 23:00"
  },
  {
    sportSlug: "cau-long",
    name: "Sân Cầu Lông và Bóng Rổ Rian Sports - Gò Vấp",
    address: "185b Nguyễn Oanh, Gò Vấp, Hồ Chí Minh 700000, Việt Nam",
    district: "Gò Vấp",
    latitude: 10.8341821,
    longitude: 106.6754069,
    rating: 4.7,
    ratingCount: 351,
    openHours: "Đóng cửa vào 0:00"
  },
  {
    sportSlug: "pickleball",
    name: "Sân Pickle Pickle",
    address: "1 Đ. Số 38, An Khánh, Hồ Chí Minh, Việt Nam",
    district: "",
    latitude: 10.8023225,
    longitude: 106.7329928,
    rating: 4.9,
    ratingCount: 305,
    openHours: "Đóng cửa vào 23:00"
  },
  {
    sportSlug: "pickleball",
    name: "Sân Pickleball - PickCar Club",
    address: "30/19 Đ. Số 9, Hiệp Bình, Hồ Chí Minh, Việt Nam",
    district: "",
    latitude: 10.8314402,
    longitude: 106.7106792,
    rating: 4.8,
    ratingCount: 39,
    openHours: "Đóng cửa vào 22:00"
  },
  {
    sportSlug: "pickleball",
    name: "Nguyễn Du Pickleball Club",
    address: "116 Nguyễn Du, Bến Thành, Hồ Chí Minh, Việt Nam",
    district: "",
    latitude: 10.7734339,
    longitude: 106.693732,
    rating: 4.4,
    ratingCount: 31,
    openHours: "Đóng cửa vào 22:00"
  },
  {
    sportSlug: "pickleball",
    name: "SÂN PICKLEBALL PICKLECOOL",
    address: "2 Nguyễn Đức Thuận, Tân Bình, Hồ Chí Minh, Việt Nam",
    district: "Tân Bình",
    latitude: 10.8049729,
    longitude: 106.6420676,
    rating: 4.8,
    ratingCount: 49,
    openHours: "Đóng cửa vào 23:00"
  },
  {
    sportSlug: "pickleball",
    name: "Sân Pickleball Saigon",
    address: "2A Trương Văn Bang, Bình Trưng, Hồ Chí Minh 700000, Việt Nam",
    district: "",
    latitude: 10.7813739,
    longitude: 106.7503298,
    rating: 4.4,
    ratingCount: 39,
    openHours: "Mở cả ngày"
  },
  {
    sportSlug: "pickleball",
    name: "91 Pickleball Clubhouse (Viet Nam)",
    address: "308 Bình Quới, Hồ Chí Minh, Việt Nam",
    district: "",
    latitude: 10.8218367,
    longitude: 106.7295587,
    rating: 4.8,
    ratingCount: 65,
    openHours: "Đóng cửa vào 22:00"
  },
  {
    sportSlug: "pickleball",
    name: "SÂN PICKLEBALL CLUB 21",
    address: "103 Dương Quảng Hàm, Hạnh Thông, Hồ Chí Minh 700000, Việt Nam",
    district: "",
    latitude: 10.8299194,
    longitude: 106.6876182,
    rating: 4.7,
    ratingCount: 40,
    openHours: "Đóng cửa vào 22:00"
  },
  {
    sportSlug: "pickleball",
    name: "BSB Pickleball Club",
    address: "Trần Não/22 Đường 29, Khu phố 1, An Khánh, Hồ Chí Minh, Việt Nam",
    district: "",
    latitude: 10.7927148,
    longitude: 106.728375,
    rating: 4.7,
    ratingCount: 123,
    openHours: "Đóng cửa vào 22:00"
  },
  {
    sportSlug: "pickleball",
    name: "Sân Thể Thao Pickleball Sơn Phú Nhân",
    address: "Đường Số 2, Khu Phố 5, Bình Tân, Hồ Chí Minh 71959, Việt Nam",
    district: "Bình Tân",
    latitude: 10.8018769,
    longitude: 106.5944773,
    rating: 4.9,
    ratingCount: 16,
    openHours: "Đóng cửa vào 22:00"
  },
  {
    sportSlug: "pickleball",
    name: "PooC Cầu Lông & PickleBall",
    address: "202B Đ. Hoàng Văn Thụ, Đức Nhuận, Hồ Chí Minh 700000, Việt Nam",
    district: "",
    latitude: 10.8002048,
    longitude: 106.6695914,
    rating: 4.8,
    ratingCount: 1449,
    openHours: "Đóng cửa vào 0:00"
  },
  {
    sportSlug: "pickleball",
    name: "Sân Pickleball Malibu",
    address: "25 Đường C7C, Bình Hưng, Hồ Chí Minh 739500, Việt Nam",
    district: "",
    latitude: 10.7335176,
    longitude: 106.6812091,
    rating: 4.9,
    ratingCount: 95,
    openHours: "Đóng cửa vào 22:30"
  },
  {
    sportSlug: "pickleball",
    name: "MỘC PICKLEBALL",
    address: "18E Cộng Hòa, Bảy Hiền, Hồ Chí Minh 700000, Việt Nam",
    district: "",
    latitude: 10.8087543,
    longitude: 106.6519364,
    rating: 4.8,
    ratingCount: 28,
    openHours: "Mở cả ngày"
  },
  {
    sportSlug: "pickleball",
    name: "KEYFIT PICKLEBALL",
    address: "102-104 Nguyễn Trãi, Chợ Quán, Hồ Chí Minh 700000, Việt Nam",
    district: "",
    latitude: 10.7578937,
    longitude: 106.6793353,
    rating: 4.9,
    ratingCount: 11,
    openHours: "Đóng cửa vào 21:00"
  },
  {
    sportSlug: "pickleball",
    name: "3T Pickleball Club - Sân trong nhà",
    address: "1085 Tạ Quang Bửu, Bình Đông, Hồ Chí Minh, Việt Nam",
    district: "",
    latitude: 10.730231,
    longitude: 106.6462585,
    rating: 4.7,
    ratingCount: 103,
    openHours: "Đóng cửa vào 22:00"
  },
  {
    sportSlug: "pickleball",
    name: "The MM Pickleball Club",
    address: "65 Mai Chí Thọ, Bình Trưng, Hồ Chí Minh 70000, Việt Nam",
    district: "",
    latitude: 10.7965801,
    longitude: 106.7515966,
    rating: 4.3,
    ratingCount: 82,
    openHours: "Đóng cửa vào 22:00"
  },
  {
    sportSlug: "pickleball",
    name: "BALOPICK CLUB - SÂN PICKLEBALL ĐINH THỊ THI",
    address: "58 Đinh Thị Thi, Hiệp Bình, Hồ Chí Minh, Việt Nam",
    district: "",
    latitude: 10.8449847,
    longitude: 106.7148077,
    rating: 4.7,
    ratingCount: 28,
    openHours: "Đóng cửa vào 22:00"
  },
  {
    sportSlug: "pickleball",
    name: "TOP Pickleball",
    address: "179 Cao Đức Lân, Khu đô thị An Phú An Khánh, Bình Trưng, Hồ Chí Minh, Việt Nam",
    district: "",
    latitude: 10.7912755,
    longitude: 106.7420958,
    rating: 4.7,
    ratingCount: 61,
    openHours: "Đóng cửa vào 22:00"
  },
  {
    sportSlug: "pickleball",
    name: "Sân Pickleball Tân Phú - Sân Pickleball 168 Nguyễn Hữu Dật",
    address: "168 Nguyễn Hữu Dật, Tây Thạnh, Hồ Chí Minh 00700, Việt Nam",
    district: "",
    latitude: 10.8115928,
    longitude: 106.6302114,
    rating: 4.5,
    ratingCount: 66,
    openHours: "Đóng cửa vào 22:00"
  },
  {
    sportSlug: "pickleball",
    name: "Happy Hub Pickleball",
    address: "93, Nguyễn Hoàng/9 Mai Chí Thọ, Bình Trưng, Hồ Chí Minh 70000, Việt Nam",
    district: "",
    latitude: 10.7958858,
    longitude: 106.7481127,
    rating: 4.7,
    ratingCount: 57,
    openHours: "Đóng cửa vào 22:00"
  },
  {
    sportSlug: "pickleball",
    name: "Pickleball Quận 1 - Saigon",
    address: "189 Đ. Cống Quỳnh, Cầu Ông Lãnh, Hồ Chí Minh, Việt Nam",
    district: "",
    latitude: 10.766947,
    longitude: 106.687207,
    rating: 3.7,
    ratingCount: 22,
    openHours: "Đóng cửa vào 22:00"
  },
  {
    sportSlug: "bong-da-mini",
    name: "Sân bóng đá mini",
    address: "QJ3F+M97, An Lạc, Hồ Chí Minh, Việt Nam",
    district: "",
    latitude: 10.754156,
    longitude: 106.6234098,
    rating: 4.7,
    ratingCount: 20,
    openHours: null
  },
  {
    sportSlug: "bong-da-mini",
    name: "SÂN BÓNG ĐÁ MINI CỎ NHÂN TẠO NGÂN VŨ",
    address: "439/5A Nguyễn Văn Khối, Thông Tây Hội, Hồ Chí Minh, Việt Nam",
    district: "",
    latitude: 10.8438561,
    longitude: 106.6467466,
    rating: 4.5,
    ratingCount: 49,
    openHours: "Mở cả ngày"
  },
  {
    sportSlug: "bong-da-mini",
    name: "Sân bóng Mini Bình Minh",
    address: "158 Bình Quới, Cư xá Thanh Đa, Bình Quới, Hồ Chí Minh 70000, Việt Nam",
    district: "",
    latitude: 10.8181128,
    longitude: 106.7240921,
    rating: 3.9,
    ratingCount: 166,
    openHours: "Đóng cửa vào 22:00"
  },
  {
    sportSlug: "bong-da-mini",
    name: "Sân Bóng Đá Mini Minh Tâm",
    address: "7/2 Tổ 57 Âp Trung Đông, Đông Thạnh, Hồ Chí Minh, Việt Nam",
    district: "",
    latitude: 10.8965419,
    longitude: 106.6176719,
    rating: 4.2,
    ratingCount: 5,
    openHours: "Mở cả ngày"
  },
  {
    sportSlug: "bong-da-mini",
    name: "Sân Bóng Đá Mini Sake",
    address: "12a Đ. số 42, Khu Phố 6, Thủ Đức, Hồ Chí Minh, Việt Nam",
    district: "Thủ Đức",
    latitude: 10.8482715,
    longitude: 106.7511819,
    rating: 4.2,
    ratingCount: 121,
    openHours: "Đóng cửa vào 23:00"
  },
  {
    sportSlug: "bong-da-mini",
    name: "Sân bóng đá mini",
    address: "PPFC+7RM, Khu đô thị Phú Mỹ Hưng, Tân Mỹ, Hồ Chí Minh, Việt Nam",
    district: "",
    latitude: 10.7232081,
    longitude: 106.722039,
    rating: 4.5,
    ratingCount: 4,
    openHours: "Đang mở cửa"
  },
  {
    sportSlug: "bong-da-mini",
    name: "Sân Bóng Đá Mini Thiên Sứ",
    address: "VJ3Q+QX5, Đ. Nguyễn Văn Quá, Tân Thới Hiệp, Hồ Chí Minh, Việt Nam",
    district: "",
    latitude: 10.8543821,
    longitude: 106.6399741,
    rating: 4.5,
    ratingCount: 19,
    openHours: "Đóng cửa vào 22:00"
  },
  {
    sportSlug: "bong-da-mini",
    name: "Sân Banh Mini Quyền",
    address: "21 Đ. Đào Duy Anh, Đức Nhuận, Hồ Chí Minh, Việt Nam",
    district: "",
    latitude: 10.8055451,
    longitude: 106.6758356,
    rating: 4.1,
    ratingCount: 377,
    openHours: "Đóng cửa vào 0:00"
  },
  {
    sportSlug: "bong-da-mini",
    name: "Sân Bóng Đá Mini Bình Chiểu",
    address: "VPHG+FXM, Tam Bình, Hồ Chí Minh, Việt Nam",
    district: "",
    latitude: 10.8787177,
    longitude: 106.7274314,
    rating: 4.4,
    ratingCount: 49,
    openHours: "Mở cả ngày"
  },
  {
    sportSlug: "bong-da-mini",
    name: "Sân Bóng Đá Mini Thanh Răng",
    address: "41 HL80B, Đông Thạnh, Hồ Chí Minh, Việt Nam",
    district: "",
    latitude: 10.9000584,
    longitude: 106.6439257,
    rating: 4.2,
    ratingCount: 28,
    openHours: "Mở cả ngày"
  },
  {
    sportSlug: "bong-da-mini",
    name: "Sân Bóng Đá Mini Victory",
    address: "426 Bình Quới, Hồ Chí Minh, Việt Nam",
    district: "",
    latitude: 10.8246737,
    longitude: 106.7355438,
    rating: 4.2,
    ratingCount: 225,
    openHours: "Đóng cửa vào 23:30"
  },
  {
    sportSlug: "bong-da-mini",
    name: "Clb Sân Bóng Đá Mini Nguyên Bảo",
    address: "532 Đường Lê Minh Nhựt, Tân An Hội, Hồ Chí Minh, Việt Nam",
    district: "",
    latitude: 10.9541634,
    longitude: 106.4744622,
    rating: 4.1,
    ratingCount: 23,
    openHours: "Mở cả ngày"
  },
  {
    sportSlug: "bong-da-mini",
    name: "Sân Bóng Đá Mini Tân Thới Hòa",
    address: "17 Lương Minh Nguyệt, Phú Thạnh, Hồ Chí Minh, Việt Nam",
    district: "",
    latitude: 10.7603188,
    longitude: 106.6310048,
    rating: 3.6,
    ratingCount: 133,
    openHours: "Đóng cửa vào 22:00"
  },
  {
    sportSlug: "bong-da-mini",
    name: "Sân bóng đá mini Nhà Tập Luyện Phú Thọ",
    address: "219 Đ. Lý Thường Kiệt, Quận 11, Hồ Chí Minh 70000, Việt Nam",
    district: "Quận 11",
    latitude: 10.767572,
    longitude: 106.6583786,
    rating: 4.4,
    ratingCount: 498,
    openHours: "Đóng cửa vào 23:01"
  },
  {
    sportSlug: "bong-da-mini",
    name: "Sân Bóng Đá Mini Liverpool.Vn",
    address: "QJGC+R42, Đ. Số 2, Bình Trị Đông, Hồ Chí Minh, Việt Nam",
    district: "",
    latitude: 10.7770001,
    longitude: 106.6202686,
    rating: 4.6,
    ratingCount: 27,
    openHours: null
  },
  {
    sportSlug: "bong-da-mini",
    name: "Sân bóng đá mini Việt Phát",
    address: "Đường 224, Bình Mỹ, Hồ Chí Minh, Việt Nam",
    district: "",
    latitude: 10.9805089,
    longitude: 106.6194834,
    rating: 4.5,
    ratingCount: 26,
    openHours: null
  },
  {
    sportSlug: "bong-da-mini",
    name: "Sân Đá Banh Mini Thành Phát",
    address: "178 Lê Đại Hành, Phú Thọ, Hồ Chí Minh, Việt Nam",
    district: "",
    latitude: 10.7646099,
    longitude: 106.656197,
    rating: 3.5,
    ratingCount: 132,
    openHours: null
  },
  {
    sportSlug: "bong-da-mini",
    name: "Sân bóng đá mini Việt Nhí sport",
    address: "75/38 Nguyễn Sỹ Sách, Tân Sơn, Hồ Chí Minh 70000, Việt Nam",
    district: "",
    latitude: 10.819955,
    longitude: 106.6354719,
    rating: 4.3,
    ratingCount: 14,
    openHours: "Mở cả ngày"
  },
  {
    sportSlug: "bong-da-mini",
    name: "Sân bóng đá mini Vạn Nguyên",
    address: "118/29/15/6 Phú Định, Hồ Chí Minh, Việt Nam",
    district: "",
    latitude: 10.7276704,
    longitude: 106.6299484,
    rating: 3.7,
    ratingCount: 133,
    openHours: "Đóng cửa vào 0:00"
  },
  {
    sportSlug: "bong-da-mini",
    name: "Sân Bóng Đá Mini An hội đường Phan Huy ich",
    address: "Phan Huy Ích, An Hội Tây, Hồ Chí Minh, Việt Nam",
    district: "",
    latitude: 10.8380788,
    longitude: 106.6400827,
    rating: 4.2,
    ratingCount: 15,
    openHours: "Mở cả ngày"
  },
  {
    sportSlug: "quan-vot",
    name: "Sân Tennis ĐH Ngân Hàng TPHCM",
    address: "56 Đ. Hoàng Diệu 2, Thủ Đức, Hồ Chí Minh, Việt Nam",
    district: "Thủ Đức",
    latitude: 10.8576785,
    longitude: 106.7609035,
    rating: 4.2,
    ratingCount: 32,
    openHours: "Đóng cửa vào 23:00"
  },
  {
    sportSlug: "quan-vot",
    name: "Sân Tennis Trung Thiện",
    address: "35 Hiệp Thành 19, Tân Thới Hiệp, Hồ Chí Minh, Việt Nam",
    district: "",
    latitude: 10.8727832,
    longitude: 106.6419496,
    rating: 4.1,
    ratingCount: 100,
    openHours: "Đóng cửa vào 22:00"
  },
  {
    sportSlug: "quan-vot",
    name: "Sân Tennis Khánh Hội",
    address: "Đ. Số 48/219 Đ. Vĩnh Hội, Phường, Vĩnh Hội, Hồ Chí Minh, Việt Nam",
    district: "",
    latitude: 10.7561483,
    longitude: 106.7001869,
    rating: 4.1,
    ratingCount: 45,
    openHours: "Mở cả ngày"
  },
  {
    sportSlug: "quan-vot",
    name: "Sân Tennis & Pickleball VIỆT PHỐ Q.7",
    address: "28-30 Đường số 79, Tân Hưng, Hồ Chí Minh, Việt Nam",
    district: "",
    latitude: 10.7399852,
    longitude: 106.7116349,
    rating: 4.5,
    ratingCount: 61,
    openHours: "Đóng cửa vào 23:00"
  },
  {
    sportSlug: "quan-vot",
    name: "Sân Tennis Saigon 5 Center",
    address: "Khu phố 1, An Khánh, Hồ Chí Minh, Việt Nam",
    district: "",
    latitude: 10.7901193,
    longitude: 106.7288651,
    rating: 4.4,
    ratingCount: 47,
    openHours: "Đóng cửa vào 22:00"
  },
  {
    sportSlug: "quan-vot",
    name: "Hoang Thien Tennis Court",
    address: "19 Dương Quang Đông, Chánh Hưng, Hồ Chí Minh 700000, Việt Nam",
    district: "",
    latitude: 10.7388528,
    longitude: 106.6670167,
    rating: 4.0,
    ratingCount: 95,
    openHours: null
  },
  {
    sportSlug: "quan-vot",
    name: "Câu Lạc Bộ Tennis Khang An",
    address: "18A Đ. Phan Văn Trị, Gò Vấp, Hồ Chí Minh, Việt Nam",
    district: "Gò Vấp",
    latitude: 10.8337504,
    longitude: 106.6724229,
    rating: 4.3,
    ratingCount: 173,
    openHours: "Mở cả ngày"
  },
  {
    sportSlug: "quan-vot",
    name: "Sân tennis Nhật Nguyệt",
    address: "149/4 Bình Quới, Cư xá Thanh Đa, Bình Quới, Hồ Chí Minh, Việt Nam",
    district: "",
    latitude: 10.8197879,
    longitude: 106.7238176,
    rating: 4.5,
    ratingCount: 28,
    openHours: "Mở cả ngày"
  },
  {
    sportSlug: "quan-vot",
    name: "Sân Tennis Jack Sport - Quận 8",
    address: "61/36 Đ. Phạm Hùng, Bình Hưng, Hồ Chí Minh, Việt Nam",
    district: "",
    latitude: 10.7301768,
    longitude: 106.675972,
    rating: 4.8,
    ratingCount: 36,
    openHours: "Đóng cửa vào 23:30"
  },
  {
    sportSlug: "quan-vot",
    name: "Sân Tennis Lê Gia",
    address: "26 Đường Số 22, Hiệp Bình, Hồ Chí Minh, Việt Nam",
    district: "",
    latitude: 10.8521582,
    longitude: 106.7443823,
    rating: 4.5,
    ratingCount: 72,
    openHours: "Đóng cửa vào 20:00"
  },
  {
    sportSlug: "quan-vot",
    name: "Sân Tennis 41 BIS",
    address: "11a Điện Biên Phủ, Thạnh Mỹ Tây, Hồ Chí Minh, Việt Nam",
    district: "",
    latitude: 10.8017814,
    longitude: 106.7210944,
    rating: 4.3,
    ratingCount: 15,
    openHours: "Đóng cửa vào 22:00"
  },
  {
    sportSlug: "quan-vot",
    name: "Sân Tennis - Pickleball Đông Sài Gòn",
    address: "68 Liên Phường, Bình Trưng, Hồ Chí Minh, Việt Nam",
    district: "",
    latitude: 10.8030671,
    longitude: 106.7608683,
    rating: 4.8,
    ratingCount: 48,
    openHours: "Đóng cửa vào 22:00"
  },
  {
    sportSlug: "quan-vot",
    name: "Sân Tennis Phương Anh",
    address: "Khu Công Nghiệp, Đường C/Lô 9E Tân Tạo, Hồ Chí Minh 700000, Việt Nam",
    district: "",
    latitude: 10.7401572,
    longitude: 106.5949095,
    rating: 4.8,
    ratingCount: 12,
    openHours: "Đóng cửa vào 21:00"
  },
  {
    sportSlug: "quan-vot",
    name: "Sân tennis Điện Lực",
    address: "479 Tô Ký, Trung Mỹ Tây, Hồ Chí Minh, Việt Nam",
    district: "",
    latitude: 10.8565672,
    longitude: 106.6208409,
    rating: 4.6,
    ratingCount: 9,
    openHours: "Đóng cửa vào 23:00"
  },
  {
    sportSlug: "quan-vot",
    name: "Sân Tennis Tấn Trường",
    address: "96 Đ. Đào Trí, Phú Thuận, Hồ Chí Minh 700000, Việt Nam",
    district: "",
    latitude: 10.7182638,
    longitude: 106.7445404,
    rating: 4.7,
    ratingCount: 59,
    openHours: "Mở cả ngày"
  },
  {
    sportSlug: "quan-vot",
    name: "Sân Tennis Trần Thái",
    address: "PPF3+RMG, Nhà Bè, Hồ Chí Minh, Việt Nam",
    district: "Nhà Bè",
    latitude: 10.7245724,
    longitude: 106.7041933,
    rating: 4.4,
    ratingCount: 31,
    openHours: null
  },
  {
    sportSlug: "quan-vot",
    name: "Sân Tennis Mặt Bê-tông ACE Sport - Vạn Phúc City",
    address: "Đường số 18, Khu đô Thị Vạn Phúc, Hiệp Bình, Hồ Chí Minh 80000, Việt Nam",
    district: "",
    latitude: 10.8422523,
    longitude: 106.7060932,
    rating: 4.9,
    ratingCount: 19,
    openHours: "Đóng cửa vào 23:30"
  },
  {
    sportSlug: "quan-vot",
    name: "Trung Tâm Dạy Học Tennis Quận Tân Bình TpHCM",
    address: "18D Cộng Hòa, Bảy Hiền, Hồ Chí Minh 700000, Việt Nam",
    district: "",
    latitude: 10.8024603,
    longitude: 106.6513884,
    rating: 5.0,
    ratingCount: 66,
    openHours: "Mở cả ngày"
  },
  {
    sportSlug: "quan-vot",
    name: "Sân Tennis Văn Gia",
    address: "354/47/72 QL1A, Bình Tân, Hồ Chí Minh, Việt Nam",
    district: "Bình Tân",
    latitude: 10.807523,
    longitude: 106.5973227,
    rating: 4.7,
    ratingCount: 15,
    openHours: "Mở cả ngày"
  },
  {
    sportSlug: "quan-vot",
    name: "Sân Tennis và Cầu Lông K334",
    address: "A75/6B/52 Bạch Đằng, Tân Sơn Hòa, Hồ Chí Minh, Việt Nam",
    district: "",
    latitude: 10.8167308,
    longitude: 106.672505,
    rating: 3.2,
    ratingCount: 289,
    openHours: "Đóng cửa vào 22:00"
  },
  {
    sportSlug: "bong-ro",
    name: "Sân Bóng Rổ 29Ballers",
    address: "353/3 Bình Quới, Hồ Chí Minh 00700, Việt Nam",
    district: "",
    latitude: 10.8274997,
    longitude: 106.7347057,
    rating: 4.9,
    ratingCount: 50,
    openHours: "Mở cả ngày"
  },
  {
    sportSlug: "bong-ro",
    name: "Sân bóng rổ Don Bosco",
    address: "258/3 Dương Quảng Hàm, An Nhơn, Hồ Chí Minh, Việt Nam",
    district: "",
    latitude: 10.8300962,
    longitude: 106.6894607,
    rating: 4.6,
    ratingCount: 37,
    openHours: "Đóng cửa vào 23:00"
  },
  {
    sportSlug: "bong-ro",
    name: "Sân Thể thao Đa năng Lam Sơn",
    address: "320/1 Trần Bình Trọng, Chợ Quán, Hồ Chí Minh, Việt Nam",
    district: "",
    latitude: 10.7623271,
    longitude: 106.6798241,
    rating: 4.2,
    ratingCount: 457,
    openHours: "Mở cả ngày"
  },
  {
    sportSlug: "bong-ro",
    name: "Sân Bóng Rổ",
    address: "QMV3+PG8, Tân Sơn Nhất, Hồ Chí Minh, Việt Nam",
    district: "",
    latitude: 10.7942826,
    longitude: 106.6538304,
    rating: 3.9,
    ratingCount: 44,
    openHours: "Mở cả ngày"
  },
  {
    sportSlug: "bong-ro",
    name: "Sân bóng rổ Saigon East",
    address: "QPXX+MHC, Bình Trưng, Hồ Chí Minh, Việt Nam",
    district: "",
    latitude: 10.7991826,
    longitude: 106.7489023,
    rating: 5.0,
    ratingCount: 5,
    openHours: "Mở cả ngày"
  },
  {
    sportSlug: "bong-ro",
    name: "HYPERHALL - Basketball Court - Sân Bóng Rổ",
    address: "47 Đường Số 29, Khu phố 1, An Khánh, Hồ Chí Minh, Việt Nam",
    district: "",
    latitude: 10.7926833,
    longitude: 106.7284004,
    rating: 5.0,
    ratingCount: 180,
    openHours: "Đóng cửa vào 22:00"
  },
  {
    sportSlug: "bong-ro",
    name: "Trung tâm Thể dục Thể thao Hoa Lư",
    address: "2 Đinh Tiên Hoàng, Sài Gòn, Hồ Chí Minh, Việt Nam",
    district: "",
    latitude: 10.7879361,
    longitude: 106.7015942,
    rating: 4.2,
    ratingCount: 5261,
    openHours: "Đóng cửa 11:30 · Mở cửa lại 13:30"
  },
  {
    sportSlug: "bong-ro",
    name: "Nhà thi đấu Nguyễn Du",
    address: "116 Nguyễn Du, Bến Thành, Hồ Chí Minh 700000, Việt Nam",
    district: "",
    latitude: 10.7732829,
    longitude: 106.6929444,
    rating: 4.3,
    ratingCount: 1058,
    openHours: "Đóng cửa vào 22:00"
  },
  {
    sportSlug: "bong-ro",
    name: "SeventySeven Basketball Court",
    address: "224 Đ. Thành Thái, Diên Hồng, Hồ Chí Minh, Việt Nam",
    district: "",
    latitude: 10.7792625,
    longitude: 106.6594087,
    rating: 4.4,
    ratingCount: 61,
    openHours: "Mở cả ngày"
  },
  {
    sportSlug: "bong-ro",
    name: "Sân bóng rổ",
    address: "219 Đ. Lý Thường Kiệt, Phú Thọ, Hồ Chí Minh, Việt Nam",
    district: "",
    latitude: 10.7677972,
    longitude: 106.6581484,
    rating: 4.6,
    ratingCount: 10,
    openHours: "Mở cả ngày"
  },
  {
    sportSlug: "bong-ro",
    name: "Trung tâm Văn hoá Thể thao Lá Phong - Sân bóng rổ Saigon Heat",
    address: "7 Đ. Số 23, Quận 7, Hồ Chí Minh 700000, Việt Nam",
    district: "Quận 7",
    latitude: 10.7133932,
    longitude: 106.7279098,
    rating: 4.9,
    ratingCount: 11,
    openHours: "Đóng cửa vào 17:30"
  },
  {
    sportSlug: "bong-ro",
    name: "Câu lạc bộ thể thao Hồ Xuân Hương",
    address: "2 Hồ Xuân Hương, Xuân Hòa, Hồ Chí Minh, Việt Nam",
    district: "",
    latitude: 10.7773714,
    longitude: 106.6875538,
    rating: 4.2,
    ratingCount: 1393,
    openHours: "Đóng cửa vào 22:00"
  },
  {
    sportSlug: "bong-ro",
    name: "SSHOOPS basketball court",
    address: "14/3 Minh Phụng, Đông Hưng Thuận, Hồ Chí Minh 70000, Việt Nam",
    district: "",
    latitude: 10.8299124,
    longitude: 106.6202031,
    rating: 5.0,
    ratingCount: 13,
    openHours: "Đóng cửa vào 23:00"
  },
  {
    sportSlug: "bong-ro",
    name: "Sân Bóng Rổ Tiger Arena",
    address: "16 Đ. Đông Hưng Thuận 10B, Đông Hưng Thuận, Hồ Chí Minh, Việt Nam",
    district: "",
    latitude: 10.8319351,
    longitude: 106.6299742,
    rating: 4.9,
    ratingCount: 19,
    openHours: null
  },
  {
    sportSlug: "bong-ro",
    name: "CLB Bóng rổ Đông Sơn Lion",
    address: "9 Đ. Thành Thái, Diên Hồng, Hồ Chí Minh, Việt Nam",
    district: "",
    latitude: 10.7696563,
    longitude: 106.6659055,
    rating: 4.9,
    ratingCount: 11,
    openHours: "Mở cả ngày"
  },
  {
    sportSlug: "bong-ro",
    name: "Sân bóng rổ Jumpshot",
    address: "RQ3V+CVP, The Minh Son, Long Trường, Hồ Chí Minh, Việt Nam",
    district: "",
    latitude: 10.8033111,
    longitude: 106.79458,
    rating: 4.6,
    ratingCount: 45,
    openHours: null
  },
  {
    sportSlug: "bong-ro",
    name: "CLB Bóng Rổ Alpha - 144 Đồng Đen (Trong CLB TDTT Bàu Cát)",
    address: "144 Đồng Đen, Tân Bình, Hồ Chí Minh 72112, Việt Nam",
    district: "Tân Bình",
    latitude: 10.7908255,
    longitude: 106.6433806,
    rating: 5.0,
    ratingCount: 85,
    openHours: "Đóng cửa vào 21:00"
  },
  {
    sportSlug: "bong-ro",
    name: "Sân bóng rổ SSHoops",
    address: "14/3 Minh Phụng, Đông Hưng Thuận, Hồ Chí Minh 70000, Việt Nam",
    district: "",
    latitude: 10.8300416,
    longitude: 106.6198782,
    rating: 4.8,
    ratingCount: 24,
    openHours: "Đóng cửa vào 0:00"
  },
  {
    sportSlug: "bong-ro",
    name: "Seventy-Seven Basketball Center Q8",
    address: "277A Đ. Bình Đông, Phú Định, Hồ Chí Minh, Việt Nam",
    district: "",
    latitude: 10.7408152,
    longitude: 106.6498373,
    rating: 4.8,
    ratingCount: 56,
    openHours: "Mở cả ngày"
  },
  {
    sportSlug: "bong-ro",
    name: "Sân Bóng Rổ Bình Tân",
    address: "1 Bùi Tư Toàn, An Lạc, Hồ Chí Minh, Việt Nam",
    district: "",
    latitude: 10.7325092,
    longitude: 106.6132298,
    rating: 4.8,
    ratingCount: 6,
    openHours: "Đóng cửa vào 22:00"
  },
  {
    sportSlug: "boi-loi",
    name: "Hồ bơi Văn Thánh",
    address: "48/10 Điện Biên Phủ, Thạnh Mỹ Tây, Hồ Chí Minh, Việt Nam",
    district: "",
    latitude: 10.7977835,
    longitude: 106.7144898,
    rating: 4.1,
    ratingCount: 2672,
    openHours: "07:00–19:00 hàng ngày"
  },
  {
    sportSlug: "boi-loi",
    name: "Hồ bơi Sky Garden",
    address: "2 Đ. Phạm Văn Nghị, Khu đô thị Phú Mỹ Hưng, Tân Hưng, Hồ Chí Minh, Việt Nam",
    district: "",
    latitude: 10.7315018,
    longitude: 106.7058083,
    rating: 4.2,
    ratingCount: 502,
    openHours: "06:00–22:00 hàng ngày"
  },
  {
    sportSlug: "boi-loi",
    name: "Hồ Bơi Rạch Miễu",
    address: "1 Đ. Hoa Phượng, Cầu Kiệu, Hồ Chí Minh 72210, Việt Nam",
    district: "",
    latitude: 10.7958177,
    longitude: 106.6878838,
    rating: 4.0,
    ratingCount: 1526,
    openHours: "Thứ Ba–Chủ Nhật: 05:30–10:00, 13:30–19:00; Thứ Hai: Đóng cửa"
  },
  {
    sportSlug: "boi-loi",
    name: "Hồ bơi Kỳ Đồng",
    address: "40 Đ. Kỳ Đồng",
    district: "",
    latitude: 10.7805614,
    longitude: 106.6807936,
    rating: 3.8,
    ratingCount: 575,
    openHours: "Đóng cửa vào 18:00"
  },
  {
    sportSlug: "boi-loi",
    name: "Hồ bơi Hòa Bình",
    address: "9 Đ. Phạm Hùng",
    district: "",
    latitude: 10.7360221,
    longitude: 106.6722865,
    rating: 3.8,
    ratingCount: 817,
    openHours: "Đóng cửa vào 19:00"
  },
  {
    sportSlug: "boi-loi",
    name: "Hồ bơi Lam Sơn",
    address: "242 Trần Bình Trọng",
    district: "",
    latitude: 10.7620296,
    longitude: 106.6806787,
    rating: 3.9,
    ratingCount: 1098,
    openHours: "Đóng cửa 11:30 · Mở cửa lại 13:30"
  },
  {
    sportSlug: "boi-loi",
    name: "Hồ bơi Cộng Hòa",
    address: "1034 Cách Mạng Tháng Tám",
    district: "",
    latitude: 10.7910395,
    longitude: 106.6581592,
    rating: 3.6,
    ratingCount: 592,
    openHours: "Đóng cửa vào 20:00"
  },
  {
    sportSlug: "boi-loi",
    name: "Hồ bơi Nguyễn Tri Phương",
    address: "27 Đ. Đồng Nai",
    district: "",
    latitude: 10.7816619,
    longitude: 106.6610231,
    rating: 3.7,
    ratingCount: 725,
    openHours: "Mở cửa lúc 14:00"
  },
  {
    sportSlug: "boi-loi",
    name: "Trung tâm thể thao dưới nước Yết Kiêu",
    address: "1 Nguyễn Thị Minh Khai",
    district: "",
    latitude: 10.7908074,
    longitude: 106.7058297,
    rating: 3.9,
    ratingCount: 952,
    openHours: "Đóng cửa vào 13:00 · Mở lại vào 16:00"
  },
  {
    sportSlug: "boi-loi",
    name: "Hồ Bơi Tây Thạnh Quận Tân Phú",
    address: "87 Chế Lan Viên",
    district: "Tân Phú",
    latitude: 10.8105556,
    longitude: 106.6266667,
    rating: 4.1,
    ratingCount: 1545,
    openHours: "Đóng cửa vào 18:30"
  },
  {
    sportSlug: "boi-loi",
    name: "Hồ bơi Lavie",
    address: "Unnamed",
    district: "",
    latitude: 10.8566198,
    longitude: 106.5805169,
    rating: 4.0,
    ratingCount: 185,
    openHours: "Đóng cửa vào 19:00"
  },
  {
    sportSlug: "boi-loi",
    name: "Hồ bơi Chi Lăng",
    address: "19/2B Đ. Lam Sơn",
    district: "",
    latitude: 10.8049876,
    longitude: 106.6879467,
    rating: 3.9,
    ratingCount: 299,
    openHours: "Mở cửa lúc 13:30"
  },
  {
    sportSlug: "boi-loi",
    name: "Hồ Bơi Phú Lâm",
    address: "157 Đ. Kinh Dương Vương",
    district: "",
    latitude: 10.748669,
    longitude: 106.6277604,
    rating: 2.9,
    ratingCount: 217,
    openHours: "Đóng cửa vào 19:30"
  },
  {
    sportSlug: "boi-loi",
    name: "Hồ bơi Đại Đồng",
    address: "25a Nơ Trang Long",
    district: "",
    latitude: 10.8070831,
    longitude: 106.6944414,
    rating: 3.4,
    ratingCount: 179,
    openHours: "Đóng cửa vào 18:30"
  },
  {
    sportSlug: "boi-loi",
    name: "Hồ bơi Lao Động",
    address: "6 Huyền Trân Công Chúa",
    district: "",
    latitude: 10.7755985,
    longitude: 106.6936451,
    rating: 3.8,
    ratingCount: 513,
    openHours: "Đóng cửa vào 19:00"
  },
  {
    sportSlug: "boi-loi",
    name: "Học Bơi Sài Gòn - Hồ Bơi CBD Quận 2",
    address: "125 Đồng Văn Cống",
    district: "",
    latitude: 10.7738395,
    longitude: 106.7623851,
    rating: 4.5,
    ratingCount: 43,
    openHours: "Đóng cửa vào 20:00"
  },
  {
    sportSlug: "boi-loi",
    name: "Hồ bơi Câu lạc bộ Lan Anh",
    address: "291 Hẻm 285 Cách Mạng Tháng Tám",
    district: "",
    latitude: 10.7792098,
    longitude: 106.6781607,
    rating: 3.8,
    ratingCount: 102,
    openHours: "Đóng cửa vào 19:00"
  },
  {
    sportSlug: "boi-loi",
    name: "Hồ bơi Kỳ Hòa 2",
    address: "796 Sư Vạn Hạnh",
    district: "",
    latitude: 10.7742684,
    longitude: 106.669917,
    rating: 3.5,
    ratingCount: 359,
    openHours: "Đóng cửa vào 20:00"
  },
  {
    sportSlug: "boi-loi",
    name: "Hồ Bơi Thành Trung",
    address: "108 Miếu Gò Xoài",
    district: "",
    latitude: 10.780569,
    longitude: 106.6061325,
    rating: 3.7,
    ratingCount: 277,
    openHours: "Đóng cửa vào 18:30"
  },
  {
    sportSlug: "boi-loi",
    name: "Trung Tâm Dạy Bơi Phú Nhuận (Thầy Hai)",
    address: "202B Đ. Hoàng Văn Thụ",
    district: "Phú Nhuận",
    latitude: 10.8015084,
    longitude: 106.6696988,
    rating: 4.9,
    ratingCount: 660,
    openHours: "Mở cả ngày"
  }
];

/* ------------------------------------------------------------------ */
/* Pure helpers (unit-tested in tests/real-venues-data.test.ts)        */
/* ------------------------------------------------------------------ */

/** Named HCMC districts recognised verbatim inside an address string. */
const KNOWN_DISTRICTS = [
  "Thủ Đức",
  "Tân Phú",
  "Tân Bình",
  "Phú Nhuận",
  "Bình Thạnh",
  "Gò Vấp",
  "Bình Tân",
  "Nhà Bè",
  "Bình Chánh",
  "Hóc Môn",
  "Củ Chi",
] as const;

/**
 * The address segment immediately before the "Hồ Chí Minh" segment —
 * usually the ward/locality ("Tân Hòa", "Đức Nhuận", "An Khánh").
 * Returns "" when there is no such segment or it looks like a street
 * address (house number, "Đ."/"Đường"/"Hẻm" prefix, plus-code, or any
 * digits) rather than a locality name.
 */
export function localitySegmentFromAddress(address: string): string {
  const segments = address
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  const idx = segments.findIndex((s) => s.includes("Hồ Chí Minh"));
  if (idx <= 0) return "";
  const candidate = segments[idx - 1].replace(/\s*\d{5,6}\s*$/, "").trim();
  if (!candidate) return "";
  if (/^\d/.test(candidate)) return "";
  if (/^(Đ\.|Đường|Hẻm|Khu|Tổ|Ấp|Âp)\b/.test(candidate)) return "";
  if (/^[A-Z0-9]{2,}\+/.test(candidate)) return "";
  if (/\d/.test(candidate)) return "";
  return candidate;
}

/**
 * Best-effort district from a harvested address: an explicit
 * "Quận N" or a known district name wins; otherwise the locality
 * segment before "Hồ Chí Minh"; otherwise "".
 */
export function parseDistrictFromAddress(address: string): string {
  const quan = address.match(/Quận\s*(\d{1,2})\b/);
  if (quan) return `Quận ${Number(quan[1])}`;
  for (const d of KNOWN_DISTRICTS) {
    if (address.includes(d)) return d;
  }
  return localitySegmentFromAddress(address);
}

/** District for a harvested entry: address parse first, then the
 * district recorded at harvest time (parsed from the venue name when
 * the address itself carries none), else "". */
export function resolveDistrict(address: string, harvestedDistrict: string): string {
  return parseDistrictFromAddress(address) || harvestedDistrict || "";
}

/** Identity key for cross-sport merging: normalized name + coordinates
 * at 4 decimals (~11 m) — the same business listed under two sports
 * shares both. */
export function realVenueMergeKey(entry: Pick<RawRealVenueEntry, "name" | "latitude" | "longitude">): string {
  return `${slugify(entry.name)}|${entry.latitude.toFixed(4)}|${entry.longitude.toFixed(4)}`;
}

/**
 * Merge the raw harvest into unique venues and assign deterministic
 * slugs. Merge order = raw order (first listing wins for name /
 * address / hours / rating); a venue's sports are ordered by
 * SPORT_DEFS. Slugs are slugified names, disambiguated — only when a
 * collision actually occurs — with the venue's locality token
 * (district or address locality segment), then a numeric suffix.
 */
export function buildRealVenues(raw: RawRealVenueEntry[]): RealVenue[] {
  const sportOrder = new Map<string, number>(SPORT_DEFS.map((s, i) => [s.slug, i]));
  const merged: RealVenue[] = [];
  const byKey = new Map<string, RealVenue>();
  for (const entry of raw) {
    const key = realVenueMergeKey(entry);
    const existing = byKey.get(key);
    if (existing) {
      if (!existing.sportSlugs.includes(entry.sportSlug)) {
        existing.sportSlugs.push(entry.sportSlug);
        existing.sportSlugs.sort((a, b) => (sportOrder.get(a) ?? 0) - (sportOrder.get(b) ?? 0));
      }
      continue;
    }
    const venue: RealVenue = {
      slug: "", // assigned below, once the full set is known
      name: entry.name,
      address: entry.address,
      district: resolveDistrict(entry.address, entry.district),
      latitude: entry.latitude,
      longitude: entry.longitude,
      googleRating: entry.rating,
      googleRatingCount: entry.ratingCount,
      openHours: entry.openHours,
      sportSlugs: [entry.sportSlug],
    };
    byKey.set(key, venue);
    merged.push(venue);
  }

  const used = new Set<string>();
  for (const venue of merged) {
    let slug = slugify(venue.name);
    if (used.has(slug)) {
      const locality = slugify(venue.district || localitySegmentFromAddress(venue.address));
      if (locality) slug = `${slug}-${locality}`;
    }
    let candidate = slug;
    let n = 2;
    while (used.has(candidate)) {
      candidate = `${slug}-${n}`;
      n += 1;
    }
    used.add(candidate);
    venue.slug = candidate;
  }
  return merged;
}

export interface NormalizedHours {
  openTime: string; // "HH:MM"
  closeTime: string; // "HH:MM" ("00:00" = midnight)
}

const pad2 = (s: string) => s.padStart(2, "0");

/**
 * Normalize a raw Google Maps hours string onto the venue model's
 * single daily open/close pair (applied to all 7 days):
 * - full "H:MM–H:MM" range (e.g. "06:00–23:00 hằng ngày", or the first
 *   range of a weekly string) → those times;
 * - "Mở cả ngày" / "Mở cửa cả ngày" → 05:00–23:00;
 * - closing-time-only status strings ("Đóng cửa vào 23:00") →
 *   open 05:00, that close;
 * - anything else (null, "Đang mở cửa", split-shift statuses,
 *   "Mở cửa lúc …") → the 06:00–22:00 default.
 */
export function normalizeOpenHours(raw: string | null): NormalizedHours {
  if (!raw || !raw.trim()) return { openTime: "06:00", closeTime: "22:00" };
  if (raw.includes("Mở cả ngày") || raw.includes("Mở cửa cả ngày")) {
    return { openTime: "05:00", closeTime: "23:00" };
  }
  const range = raw.match(/(\d{1,2}):(\d{2})\s*[–—-]\s*(\d{1,2}):(\d{2})/);
  if (range) {
    return { openTime: `${pad2(range[1])}:${range[2]}`, closeTime: `${pad2(range[3])}:${range[4]}` };
  }
  const closing = raw.match(/Đóng cửa vào\s*(\d{1,2}):(\d{2})/);
  if (closing) {
    return { openTime: "05:00", closeTime: `${pad2(closing[1])}:${closing[2]}` };
  }
  return { openTime: "06:00", closeTime: "22:00" };
}

/** The merged, slug-assigned real catalog (119 venues). */
export const REAL_VENUES: RealVenue[] = buildRealVenues(RAW_REAL_VENUE_ENTRIES);

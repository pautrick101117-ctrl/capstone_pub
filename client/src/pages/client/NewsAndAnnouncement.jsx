import React from "react";

const NewsAndAnnouncement = () => {
  const newsData = [
    {
      title: "BARANGAY IBA LEAGUE 2018!",
      date: "April 14, 2018",
      image: "/images/image1.png",
    },
    {
      title: "BARANGAY IBA VACCINATION 2020!",
      date: "November 16, 2020",
      image: "/images/image2.png",
    },
    {
      title: "BARANGAY IBA LEAGUE 2018!",
      date: "July 9, 2018",
      image: "/images/image1.png",
    },
    {
      title: "BARANGAY IBA VACCINATION 2020!",
      date: "November 16, 2020",
      image: "/images/image2.png",
    },
  ];

  return (
    <div className="relative min-h-screen">

      {/* BACKGROUND */}
      <img
        src="/landingPage-bg.png"
        className="absolute w-full h-full object-cover"
        alt="bg"
      />
      <div className="absolute w-full h-full bg-black/40"></div>

      {/* CONTENT */}
      <div className="relative z-10 pt-28 pb-16 px-6">

        {/* TITLE */}
        <div className="text-center mb-8">
          <h1 className="inline-block bg-green-700 text-white px-6 py-2 rounded-full font-bold text-lg shadow">
            NEWS & ANNOUNCEMENT
          </h1>
        </div>

        {/* GLASS CONTAINER */}
        <div className="max-w-4xl mx-auto bg-white/70 backdrop-blur-md rounded-2xl p-8 shadow-lg">

          {/* SUBTITLE */}
          <h2 className="text-center font-semibold text-gray-700 mb-6 border-b pb-2">
            COMMUNITY ACTIVITIES
          </h2>

          {/* GRID */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
            {newsData.map((item, index) => (
              <div
                key={index}
                className="bg-white rounded-lg shadow hover:scale-105 transition duration-300 overflow-hidden"
              >
                <img
                  src={item.image}
                  alt="news"
                  className="w-full h-40 object-cover"
                />

                <div className="p-4">
                  <h3 className="font-bold text-sm">
                    {item.title}
                  </h3>
                  <p className="text-xs text-gray-500 mt-1">
                    {item.date}
                  </p>
                </div>
              </div>
            ))}
          </div>

        </div>
      </div>
    </div>
  );
};

export default NewsAndAnnouncement;

import mysql.connector
from datetime import datetime

# 🔧 DB CONFIG — update
DB_CONFIG = {
    "host": "13.126.96.89",
    "port": "3306",
    "user": "admin",
    "password": "Sratrc@123",
    "database": "aashray",
}

RESEARCH_CENTRE = "Research Centre"  # verify exact value
SHIBIR_IDS = [217]  # 👈 PUT YOUR SHIBIR IDs HERE


def main():
    if not SHIBIR_IDS:
        print("❌ Please provide SHIBIR_IDS")
        return

    ADMIN_USER = "sudo"

    conn = mysql.connector.connect(**DB_CONFIG)
    cursor = conn.cursor()

    print("🚀 Creating attendance entries...\n")

    format_strings = ",".join(["%s"] * len(SHIBIR_IDS))

    query = f"""
    INSERT INTO shibir_attendance_db (
        shibir_id,
        bookingid,
        cardno,
        days,

        session_1, session_2, session_3,
        session_4, session_5, session_6,
        session_7, session_8, session_9,

        session_1_attendance, session_2_attendance, session_3_attendance,
        session_4_attendance, session_5_attendance, session_6_attendance,
        session_7_attendance, session_8_attendance, session_9_attendance,

        updatedBy,
        createdAt,
        updatedAt
    )
    SELECT
        b.shibir_id,
        b.bookingid,
        b.cardno,
        DATEDIFF(s.end_date, s.start_date) + 1,

        1,1,1,
        1,1,1,
        1,1,1,

        0,0,0,
        0,0,0,
        0,0,0,

        %s,
        NOW(),
        NOW()
    FROM shibir_booking_db b
    JOIN shibir_db s ON s.id = b.shibir_id
    LEFT JOIN shibir_attendance_db a
           ON a.bookingid = b.bookingid
    WHERE LOWER(b.status) = 'pending'
      AND s.start_date >= '2026-02-01'
      AND s.location = %s
      AND b.shibir_id IN ({format_strings})
      AND a.bookingid IS NULL
    """

    params = [ADMIN_USER, RESEARCH_CENTRE] + SHIBIR_IDS

    cursor.execute(query, params)
    conn.commit()

    print(f"✅ Done. Attendance rows created: {cursor.rowcount}")

    cursor.close()
    conn.close()


if __name__ == "__main__":
    main()
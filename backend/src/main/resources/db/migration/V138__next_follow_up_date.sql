-- Enrollments: "Follow Up Date" becomes the Last Follow Up Date (when the payer was last followed up with), and a
-- Next Follow Up Date is added. The follow-up dates entered so far were today-or-later dates, i.e. the next follow-up:
-- those move to the new column; past ones stay as the last follow-up.
ALTER TABLE enrollment ADD COLUMN next_follow_up_date DATE NULL;

UPDATE enrollment
   SET next_follow_up_date = follow_up_date,
       follow_up_date      = NULL
 WHERE follow_up_date IS NOT NULL
   AND follow_up_date >= CURDATE();

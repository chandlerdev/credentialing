-- Next Follow Up reminders: the follow-up date already notified (each date is notified once).
ALTER TABLE enrollment
  ADD COLUMN follow_up_notified_on DATE NULL;

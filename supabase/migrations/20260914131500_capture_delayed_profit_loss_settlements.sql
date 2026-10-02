/* Capture profit/loss transactions that are inserted as pending and completed later. */

DROP TRIGGER IF EXISTS notify_transaction_result ON public.transactions;
CREATE TRIGGER notify_transaction_result
AFTER INSERT OR UPDATE OF status, amount, type ON public.transactions
FOR EACH ROW EXECUTE FUNCTION public.create_profit_loss_notification();


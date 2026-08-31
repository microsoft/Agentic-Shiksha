"""Quick check: how many assistant messages have tokenUsage in Cosmos."""
import cosmos_queries as cq

cq._init()

all_msgs = list(cq._messages_container.query_items(
    query="SELECT c.threadId, c.metadata.tokenUsage FROM c WHERE c.role = 'assistant'",
    enable_cross_partition_query=True,
))

has_tu = 0
no_tu = 0
total_tok = 0
for m in all_msgs:
    tu = m.get("tokenUsage")
    if tu and isinstance(tu, dict) and tu.get("total_tokens", 0) > 0:
        has_tu += 1
        total_tok += tu.get("total_tokens", 0)
    else:
        no_tu += 1

print(f"Total assistant messages: {len(all_msgs)}")
print(f"With tokenUsage:          {has_tu}")
print(f"Without tokenUsage:       {no_tu}")
print(f"Total tokens stored:      {total_tok:,}")
print(f"Coverage:                 {has_tu/len(all_msgs)*100:.1f}%")

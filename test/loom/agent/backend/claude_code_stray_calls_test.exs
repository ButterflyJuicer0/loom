defmodule Loom.Agent.Backend.ClaudeCodeStrayCallsTest do
  @moduledoc """
  A reply that ends in tool calls written out as text: what the model sent
  (2.1.317, `stop_reason: "tool_use"` and no call in the response), shortened,
  and what Claude Code said next.
  """
  use ExUnit.Case, async: true

  alias Loom.Agent.Backend.ClaudeCode

  @reply "PDF 里目前没有一节集中写“前提条件”，这些内容分散在各章。要的话我可以在第 1 章加一小节。"

  @calls """
  <invoke name="Bash">
  <parameter name="command">cd /tmp/test && grep -n "s3BucketMount" notes.md | head -5</parameter>
  <parameter name="description">Confirm how the storage mounts were tested</parameter>
  </invoke>
  <invoke name="Bash">
  <parameter name="command">grep -n "too old" memory.md | cut -c1-260</parameter>
  <parameter name="description">Check the recorded facts</parameter>
  </invoke>
  """

  # The same markup with the namespace some responses give the tags, put
  # together here so this file holds none of it literally.
  @ns "antml" <> ":"
  defp namespaced(markup) do
    markup
    |> String.replace("<invoke ", "<" <> @ns <> "invoke ")
    |> String.replace("</invoke>", "</" <> @ns <> "invoke>")
    |> String.replace("<parameter ", "<" <> @ns <> "parameter ")
    |> String.replace("</parameter>", "</" <> @ns <> "parameter>")
  end

  defp handle do
    %{
      session_id: "s",
      cwd: "/tmp",
      started?: true,
      booting: nil,
      loom_id: "a_test",
      proc: :fake_proc,
      saved: nil,
      message_id: "msg_one",
      pending_blocks: [{"msg_one.1", nil}],
      buffer: "",
      tools: %{},
      interrupted?: false,
      next_control_id: 1,
      context_tokens: 0,
      context_window: nil
    }
  end

  defp feed(lines),
    do: ClaudeCode.feed(handle(), Enum.map_join(lines, "", &(Jason.encode!(&1) <> "\n")))

  describe "strip_stray_calls/1" do
    test "takes the calls off the end of the reply" do
      assert ClaudeCode.strip_stray_calls(@reply <> "\n\n" <> @calls) == @reply
    end

    test "with their wrapper, with a namespace, and when the last one was cut short" do
      wrapped = @reply <> "\n\n<function_calls>\n" <> @calls <> "</function_calls>\n"
      assert ClaudeCode.strip_stray_calls(wrapped) == @reply

      assert ClaudeCode.strip_stray_calls(@reply <> "\n\n" <> namespaced(@calls)) == @reply

      cut = @reply <> "\n\n<invoke name=\"Bash\">\n<parameter name=\"command\">ls -la /tm"
      assert ClaudeCode.strip_stray_calls(cut) == @reply
    end

    test "a reply that is nothing but the calls is left empty" do
      assert ClaudeCode.strip_stray_calls(@calls) == ""
    end

    test "leaves a reply that only talks about the syntax" do
      inline = "工具调用写成 `<invoke name=\"Bash\">` 这样的标记，后面还有正文。"
      assert ClaudeCode.strip_stray_calls(inline) == inline

      fenced = "格式如下：\n\n```xml\n" <> @calls <> "```"
      assert ClaudeCode.strip_stray_calls(fenced) == fenced

      # In a fence that was never closed, too: it is still an example.
      open = "格式如下：\n\n```xml\n" <> @calls
      assert ClaudeCode.strip_stray_calls(open) == open

      plain = "没有任何标记的普通回复。"
      assert ClaudeCode.strip_stray_calls(plain) == plain
    end

    test "text after the calls keeps them: they are not at the end" do
      followed = @reply <> "\n\n" <> @calls <> "\n然后继续说别的。"
      assert ClaudeCode.strip_stray_calls(followed) == followed
    end
  end

  describe "in a turn" do
    test "the reply is recorded without them" do
      message = %{
        "type" => "assistant",
        "parent_tool_use_id" => nil,
        "message" => %{
          "id" => "msg_one",
          "model" => "claude-fable-5-2",
          "content" => [%{"type" => "text", "text" => @reply <> "\n\n" <> @calls}]
        }
      }

      {_handle, out} = feed([message])
      assert [{:event, :assistant_text, %{block_id: "msg_one.1", text: @reply}}] = out
    end

    test "Claude Code asking the model again is said, once" do
      retry = %{
        "type" => "user",
        "isSynthetic" => true,
        "parent_tool_use_id" => nil,
        "message" => %{
          "role" => "user",
          "content" => [
            %{
              "type" => "text",
              "text" => "The previous response failed to produce a valid tool call. Please retry the tool call now."
            }
          ]
        }
      }

      {_handle, out} = feed([retry])
      assert out == [{:event, :call_retry, %{}}]

      # Any other message Claude Code writes for itself is not the user's to read.
      other = put_in(retry, ["message", "content"], [%{"type" => "text", "text" => "Continue."}])
      {_handle, out} = feed([other])
      assert out == []
    end
  end
end
